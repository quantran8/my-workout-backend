import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ProfileService } from '../profile/profile.service';
import { validateProgram, Violation } from './program-validator';
import { buildSlots, slimPool } from './pool-retrieval';
import { assembleProgram, scheduleFromProfile } from './program.helpers';
import type { Program } from './program.types';
import type { Profile } from '../profile/profile.types';
import type { Exercise } from '../profile/guardrail';

const MAX_ATTEMPTS = 3;

@Injectable()
export class ProgramService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly profileService: ProfileService,
  ) {}

  /**
   * Flow A bước 3 (đồng bộ trong request cho v1):
   *   guardrail (pool + policy) -> LLM gen -> assemble -> validateProgram -> nếu vi phạm
   *   re-prompt kèm violations (tối đa 3 lần) -> lưu Program(type=static, rev=1).
   *
   * LLM sinh, CODE gác: validateProgram là lời cuối về an toàn/khối lượng.
   */
  async generateStaticProgram(userId: string): Promise<Program> {
    const { profile } = await this.profileService.getProfile(userId);
    const userProfile = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { profileVersion: true },
    });
    const basedOnProfileVersion = userProfile?.profileVersion ?? 1;

    const guard = await this.profileService.buildGuardrail(profile, userId);
    if (!guard.allowedPool.length) {
      throw new UnprocessableEntityException(
        'Pool bài tập rỗng: chưa có bài nào được PT duyệt phù hợp với ràng buộc. Duyệt bài ở /admin/exercises/review-queue.',
      );
    }

    const schedule = scheduleFromProfile(profile);
    const targetGoals = this.targetGoals(profile, guard.policy.goalPhasePriority);
    const selected: Exercise[] = buildSlots(
      guard.allowedPool,
      targetGoals,
      schedule,
    );
    const slim = slimPool(selected.length ? selected : guard.allowedPool);

    let lastViolations: Violation[] = [];
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const draft = await this.llm.generateProgram({
        profile,
        allowedPool: slim,
        policy: guard.policy,
        schedule,
        previousViolations: lastViolations,
      });
      const program = assembleProgram(draft, {
        userId,
        basedOnProfileVersion,
      });
      const { ok, violations } = validateProgram(program, guard, {
        expectedDaysPerWeek: schedule.daysPerWeek,
      });
      if (ok) {
        await this.persist(program);
        return program;
      }
      lastViolations = violations;
    }

    throw new UnprocessableEntityException({
      message: `LLM không tạo được chương trình hợp lệ sau ${MAX_ATTEMPTS} lần.`,
      violations: lastViolations,
    });
  }

  /** GET /program/active — program + revision hiện hành. */
  async getActive(userId: string) {
    const program = await this.prisma.program.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: {
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          include: {
            sessions: {
              orderBy: [{ weekNumber: 'asc' }, { dayNumber: 'asc' }],
              include: { prescriptions: { orderBy: { order: 'asc' } } },
            },
          },
        },
      },
    });
    if (!program) throw new NotFoundException('Chưa có chương trình active');
    return program;
  }

  /**
   * §11 — safety-driven revision ĐƯỢC PHÉP trên FREE static program.
   * Append ProgramRevision N+1 (reason='safety') và bump currentRevision.
   * KHÔNG dùng invariant "static luôn = 1 revision".
   * Trả false nếu user chưa có program active.
   */
  async reviseForSafety(
    userId: string,
    input: { reason: string },
  ): Promise<boolean> {
    const program = await this.prisma.program.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: {
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          include: { sessions: { include: { prescriptions: true } } },
        },
      },
    });
    if (!program) return false;

    const latest = program.revisions[0];
    const nextNumber = (latest?.revisionNumber ?? 0) + 1;

    await this.prisma.$transaction(async (tx) => {
      const rev = await tx.programRevision.create({
        data: {
          programId: program.programId,
          revisionNumber: nextNumber,
          adjustmentReason: `safety: ${input.reason}`,
        },
      });
      // v1: sao chép nguyên các session của revision gần nhất (caps thực thi ở execution snapshot).
      for (const s of latest?.sessions ?? []) {
        const ps = await tx.plannedSession.create({
          data: {
            revisionId: rev.revisionId,
            weekNumber: s.weekNumber,
            dayNumber: s.dayNumber,
            focus: s.focus,
          },
        });
        for (const p of s.prescriptions) {
          await tx.prescription.create({
            data: {
              plannedSessionId: ps.plannedSessionId,
              exerciseId: p.exerciseId,
              order: p.order,
              targetSets: p.targetSets,
              targetReps: (p.targetReps ??
                undefined) as unknown as Prisma.InputJsonValue,
              targetWeightKg: p.targetWeightKg,
              targetDurationSec: p.targetDurationSec,
              targetDistanceM: p.targetDistanceM,
              targetRpe: p.targetRpe,
              restSec: p.restSec,
            },
          });
        }
      }
      await tx.program.update({
        where: { programId: program.programId },
        data: { currentRevision: nextNumber },
      });
    });
    return true;
  }

  // ---- helpers ----

  private targetGoals(
    profile: Profile,
    phasePriority: string[] | null,
  ): string[] {
    const needs = (profile.target?.inferredNeeds ?? []).map((n) => n.type);
    // goalPhasePriority (nếu có) ưu tiên giai đoạn 1
    return phasePriority && phasePriority.length ? [...phasePriority, ...needs] : needs;
  }

  private async persist(program: Program): Promise<void> {
    const rev = program.revision;
    await this.prisma.$transaction(async (tx) => {
      // archive program active cũ (mỗi user 1 static active)
      await tx.program.updateMany({
        where: { userId: program.userId, status: 'active' },
        data: { status: 'archived' },
      });
      await tx.program.create({
        data: {
          programId: program.programId,
          userId: program.userId,
          basedOnProfileVersion: program.basedOnProfileVersion,
          type: 'static',
          currentRevision: 1,
          goalSummary: program.goalSummary,
          phasePlan: (program.phasePlan ??
            undefined) as unknown as Prisma.InputJsonValue,
          status: 'active',
        },
      });
      await tx.programRevision.create({
        data: {
          revisionId: rev.revisionId,
          programId: program.programId,
          revisionNumber: 1,
          adjustmentReason: null,
        },
      });
      for (const s of rev.sessions) {
        await tx.plannedSession.create({
          data: {
            plannedSessionId: s.plannedSessionId,
            revisionId: rev.revisionId,
            weekNumber: s.weekNumber,
            dayNumber: s.dayNumber,
            focus: s.focus,
          },
        });
        for (const p of s.prescriptions) {
          await tx.prescription.create({
            data: {
              prescriptionId: p.prescriptionId,
              plannedSessionId: s.plannedSessionId,
              exerciseId: p.exerciseId,
              order: p.order,
              targetSets: p.targetSets,
              targetReps: (p.targetReps ??
                undefined) as unknown as Prisma.InputJsonValue,
              targetWeightKg: p.targetWeightKg ?? null,
              targetDurationSec: p.targetDurationSec ?? null,
              targetDistanceM: p.targetDistanceM ?? null,
              targetRpe: p.targetRpe ?? null,
              restSec: p.restSec,
            },
          });
        }
      }
    });
  }
}
