import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, WorkoutBlockPhase } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { ProfileService } from '../profile/profile.service';
import { validateProgram, Violation } from './program-validator';
import { buildSlots, slimPool } from './pool-retrieval';
import {
  assembleProgram,
  scheduleFromProfile,
  trainingDaysFromProfile,
} from './program.helpers';
import { computeNutrition } from './nutrition';
import { resolveDate, totalPlannedSessions } from './calendar';
import type {
  Program,
  PlannedSession,
  Prescription,
  BlockPhase,
  CurrentResponse,
  SessionPointer,
} from './program.types';
import type { Profile } from '../profile/profile.types';
import type { Exercise } from '../profile/guardrail';

const MAX_ATTEMPTS = 3;

/** Ngày UTC hôm nay dạng 'YYYY-MM-DD' — trùng cách calendar.ts đọc lịch (UTC-based). */
function todayDateString(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// Hàng Prescription đọc từ Prisma (kèm blocks). Không import kiểu generated -> giữ nhẹ.
interface PrescriptionBlockRow {
  order: number;
  phase: string;
  durationSec: number | null;
  distanceM: number | null;
  targetRpeMin: number | null;
  targetRpeMax: number | null;
  targetPaceSecPerKm: number | null;
  instruction: string;
}
interface PrescriptionRow {
  id: string;
  exerciseId: string;
  order: number;
  targetSets: number;
  targetReps: unknown;
  targetWeightKg: number | null;
  targetDurationSec: number | null;
  targetDistanceM: number | null;
  targetPaceSecPerKm: number | null;
  targetRpe: number | null;
  restSec: number;
  blocks: PrescriptionBlockRow[];
}

/**
 * mapPrescriptionRow: Prescription row -> shape `Prescription` của contract. Tên/slug lấy
 * từ Exercise row đã fetch (FK mềm); thiếu -> rỗng chứ không vỡ UI. blocks rỗng -> null
 * (bài đơn giản). Dùng chung cho /today và /active để hai endpoint không lệch shape.
 */
function mapPrescriptionRow(
  p: PrescriptionRow,
  ex?: { slug: string; name: string },
): Prescription {
  return {
    prescriptionId: p.id,
    exerciseId: p.exerciseId,
    exerciseSlug: ex?.slug ?? '',
    exerciseName: ex?.name ?? '',
    order: p.order,
    targetSets: p.targetSets,
    targetReps: (p.targetReps as number | [number, number] | null) ?? null,
    targetWeightKg: p.targetWeightKg ?? null,
    targetDurationSec: p.targetDurationSec ?? null,
    targetDistanceM: p.targetDistanceM ?? null,
    targetPaceSecPerKm: p.targetPaceSecPerKm ?? null,
    targetRpe: p.targetRpe ?? null,
    restSec: p.restSec,
    blocks: p.blocks.length
      ? p.blocks.map((b) => ({
          order: b.order,
          phase: b.phase as BlockPhase,
          durationSec: b.durationSec ?? null,
          distanceM: b.distanceM ?? null,
          targetRpeMin: b.targetRpeMin ?? null,
          targetRpeMax: b.targetRpeMax ?? null,
          targetPaceSecPerKm: b.targetPaceSecPerKm ?? null,
          instruction: b.instruction,
        }))
      : null,
  };
}

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
    // Lịch dương: chương trình bắt đầu HÔM NAY, tập những ISO weekday derive từ profile.
    // Cả hai do CODE gán (không phải LLM) — dùng để suy "hôm nay là buổi nào" khi client hỏi.
    const startDate = todayDateString();
    const trainingDays = trainingDaysFromProfile(profile);
    const targetGoals = this.targetGoals(profile, guard.policy.goalPhasePriority);
    const selected: Exercise[] = buildSlots(
      guard.allowedPool,
      targetGoals,
      schedule,
    );
    const poolForLlm = selected.length ? selected : guard.allowedPool;
    const slim = slimPool(poolForLlm);
    // LLM chọn bài theo slug -> cần map ngược sang uuid v7 trước khi ghi DB, và sang tên
    // hiển thị để đính vào response (client render, không lưu ở Prescription).
    const idBySlug = new Map(poolForLlm.map((e) => [e.slug, e.exerciseId]));
    const nameBySlug = new Map(poolForLlm.map((e) => [e.slug, e.name]));

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
        idBySlug,
        nameBySlug,
        startDate,
        trainingDays,
      });
      const { ok, violations } = validateProgram(program, guard, {
        expectedDaysPerWeek: schedule.daysPerWeek,
      });
      if (ok) {
        await this.persist(program);
        // Dinh dưỡng dẫn xuất từ profile (không lưu DB) — đính vào response để client
        // hiển thị mà không tự tính (API-3 phía mobile).
        return { ...program, nutrition: computeNutrition(profile) };
      }
      lastViolations = violations;
    }

    throw new UnprocessableEntityException({
      message: `LLM không tạo được chương trình hợp lệ sau ${MAX_ATTEMPTS} lần.`,
      violations: lastViolations,
    });
  }

  /**
   * GET /program/active — program + revision hiện hành, shape thành cùng contract
   * `Program` mà /program/generate trả (client map một kiểu duy nhất).
   *
   * Prescription chỉ có exerciseId (FK mềm, KHÔNG có relation trong schema), nên tên bài
   * được lấy bằng một query phụ và ghép vào — client cần tên để hiển thị, không map được
   * từ uuid. Dinh dưỡng tính lại từ profile như ở generate.
   */
  async getActive(userId: string): Promise<Program> {
    const row = await this.prisma.program.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      include: {
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          include: {
            sessions: {
              orderBy: [{ weekNumber: 'asc' }, { dayNumber: 'asc' }],
              include: {
                prescriptions: {
                  orderBy: { order: 'asc' },
                  // Interval steps the cardio runner walks through; empty for
                  // a simple prescription.
                  include: { blocks: { orderBy: { order: 'asc' } } },
                },
              },
            },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Chưa có chương trình active');

    const rev = row.revisions[0];
    const sessions = rev?.sessions ?? [];

    // Một query cho mọi exercise trong revision -> tên hiển thị. Slug giữ lại cho client
    // (đối chiếu/telemetry), name là thứ render trên màn plan.
    const exerciseIds = [
      ...new Set(
        sessions.flatMap((s) => s.prescriptions.map((p) => p.exerciseId)),
      ),
    ];
    const exercises = await this.prisma.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, slug: true, name: true },
    });
    const byId = new Map(exercises.map((e) => [e.id, e]));

    const { profile } = await this.profileService.getProfile(userId);

    return {
      programId: row.id,
      userId: row.userId,
      basedOnProfileVersion: row.basedOnProfileVersion,
      type: row.type,
      currentRevision: row.currentRevision,
      goalSummary: row.goalSummary,
      durationWeeks: row.durationWeeks,
      startDate: row.startDate.toISOString().slice(0, 10),
      trainingDays: row.trainingDays,
      phasePlan: (row.phasePlan as Program['phasePlan']) ?? null,
      nutrition: computeNutrition(profile),
      status: row.status,
      revision: {
        revisionId: rev?.id ?? '',
        programId: row.id,
        revisionNumber: rev?.revisionNumber ?? 1,
        createdAt: (rev?.createdAt ?? row.createdAt).toISOString(),
        adjustmentReason: rev?.adjustmentReason ?? null,
        sessions: sessions.map((s) => ({
          plannedSessionId: s.id,
          weekNumber: s.weekNumber,
          dayNumber: s.dayNumber,
          focus: s.focus,
          prescriptions: s.prescriptions.map((p) =>
            mapPrescriptionRow(p, byId.get(p.exerciseId)),
          ),
        })),
      },
    };
  }

  /**
   * GET /program/current — "buổi cần làm hiện tại" + tiến độ. Suy từ lịch dương
   * (startDate + trainingDays + durationWeeks) qua calendar.ts, KHÔNG cần row lịch/ngày.
   *
   * status: no_program | before_start | rest | program_complete | training (kèm
   * `session` của đúng (weekNumber, dayNumber) HÔM NAY). Luôn đính:
   *  - `nextSession`: buổi chưa-log kế tiếp (week/day order) — ngày rest user vẫn tập được ngay;
   *  - `progress`: "đã tập X / tổng M buổi".
   */
  async getCurrent(userId: string, date?: string): Promise<CurrentResponse> {
    const day = date ?? todayDateString();

    const row = await this.prisma.program.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        durationWeeks: true,
        startDate: true,
        trainingDays: true,
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          take: 1,
          select: {
            id: true,
            sessions: {
              orderBy: [{ weekNumber: 'asc' }, { dayNumber: 'asc' }],
              select: {
                id: true,
                weekNumber: true,
                dayNumber: true,
                focus: true,
                _count: { select: { prescriptions: true } },
              },
            },
          },
        },
      },
    });
    if (!row) {
      return {
        status: 'no_program',
        date: day,
        nextSession: null,
        progress: { completed: 0, total: 0 },
      };
    }

    const calProgram = {
      startDate: row.startDate.toISOString().slice(0, 10),
      durationWeeks: row.durationWeeks,
      trainingDays: row.trainingDays,
    };
    const total = totalPlannedSessions(calProgram);
    const rev = row.revisions[0];
    const revisionId = rev?.id;
    const plannedDays = rev?.sessions ?? [];

    // Tiến độ + nextSession dùng chung tập buổi đã completed (distinct planned day).
    const completedSessions = revisionId
      ? await this.prisma.workoutSession.findMany({
          where: { userId, status: 'completed', plannedSessionId: { not: null } },
          select: { plannedSessionId: true },
        })
      : [];
    const completedIds = new Set(
      completedSessions.map((s) => s.plannedSessionId).filter((id): id is string => id != null),
    );
    const progress = { completed: Math.min(completedIds.size, total), total };

    // nextSession = planned day đầu tiên (week/day order) chưa có completed session.
    const nextPlanned = plannedDays.find((s) => !completedIds.has(s.id));
    const nextSession: SessionPointer | null =
      nextPlanned && revisionId
        ? {
            plannedSessionId: nextPlanned.id,
            programRevisionId: revisionId,
            name: nextPlanned.focus,
            exercises: nextPlanned._count.prescriptions,
          }
        : null;

    const res = resolveDate(day, calProgram);
    if (res.status !== 'training' || !revisionId) {
      return {
        status: res.status === 'training' ? 'program_complete' : res.status,
        date: day,
        weekNumber: null,
        dayNumber: null,
        programRevisionId: revisionId ?? null,
        session: null,
        nextSession,
        progress,
      };
    }

    // Ngày tập -> lấy đúng PlannedSession (weekNumber, dayNumber), hydrate như getActive.
    const planned = await this.prisma.plannedSession.findFirst({
      where: { revisionId, weekNumber: res.weekNumber, dayNumber: res.dayNumber },
      include: {
        prescriptions: {
          orderBy: { order: 'asc' },
          include: { blocks: { orderBy: { order: 'asc' } } },
        },
      },
    });
    if (!planned) {
      // Lịch nói có buổi nhưng thiếu row (validator WEEK_COVERAGE_MISMATCH chặn khi lưu)
      // -> coi như nghỉ thay vì trả buổi rỗng.
      return {
        status: 'rest',
        date: day,
        weekNumber: res.weekNumber,
        dayNumber: res.dayNumber,
        programRevisionId: revisionId,
        session: null,
        nextSession,
        progress,
      };
    }

    const session = await this.hydratePlannedSession(planned);
    return {
      status: 'training',
      date: day,
      weekNumber: res.weekNumber,
      dayNumber: res.dayNumber,
      programRevisionId: revisionId,
      session,
      nextSession,
      progress,
    };
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
          programId: program.id,
          revisionNumber: nextNumber,
          adjustmentReason: `safety: ${input.reason}`,
        },
      });
      // v1: sao chép nguyên các session của revision gần nhất (caps thực thi ở execution snapshot).
      const copies = (latest?.sessions ?? []).map((s) => ({
        newId: randomUUID(),
        source: s,
      }));
      await tx.plannedSession.createMany({
        data: copies.map(({ newId, source }) => ({
          id: newId,
          revisionId: rev.id,
          weekNumber: source.weekNumber,
          dayNumber: source.dayNumber,
          focus: source.focus,
        })),
      });
      await tx.prescription.createMany({
        data: copies.flatMap(({ newId, source }) =>
          source.prescriptions.map((p) => ({
            plannedSessionId: newId,
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
          })),
        ),
      });
      await tx.program.update({
        where: { id: program.id },
        data: { currentRevision: nextNumber },
      });
    }, { maxWait: 10_000, timeout: 60_000 });
    return true;
  }

  // ---- helpers ----

  /**
   * hydratePlannedSession: PlannedSession row (kèm prescriptions + blocks) -> shape
   * `PlannedSession` của contract, có exerciseName/exerciseSlug. Prescription là FK mềm
   * tới Exercise (không relation) nên tên bài lấy bằng một query phụ và ghép vào — dùng
   * chung cho /program/today và /program/active.
   */
  private async hydratePlannedSession(planned: {
    id: string;
    weekNumber: number;
    dayNumber: number;
    focus: string;
    prescriptions: PrescriptionRow[];
  }): Promise<PlannedSession> {
    const exerciseIds = [...new Set(planned.prescriptions.map((p) => p.exerciseId))];
    const exercises = await this.prisma.exercise.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, slug: true, name: true },
    });
    const byId = new Map(exercises.map((e) => [e.id, e]));
    return {
      plannedSessionId: planned.id,
      weekNumber: planned.weekNumber,
      dayNumber: planned.dayNumber,
      focus: planned.focus,
      prescriptions: planned.prescriptions.map((p) =>
        mapPrescriptionRow(p, byId.get(p.exerciseId)),
      ),
    };
  }

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
          id: program.programId,
          userId: program.userId,
          basedOnProfileVersion: program.basedOnProfileVersion,
          type: 'static',
          currentRevision: 1,
          goalSummary: program.goalSummary,
          durationWeeks: program.durationWeeks,
          startDate: new Date(`${program.startDate}T00:00:00.000Z`),
          trainingDays: program.trainingDays,
          phasePlan: (program.phasePlan ??
            undefined) as unknown as Prisma.InputJsonValue,
          status: 'active',
        },
      });
      await tx.programRevision.create({
        data: {
          id: rev.revisionId,
          programId: program.programId,
          revisionNumber: 1,
          adjustmentReason: null,
        },
      });
      await tx.plannedSession.createMany({
        data: rev.sessions.map((s) => ({
          id: s.plannedSessionId,
          revisionId: rev.revisionId,
          weekNumber: s.weekNumber,
          dayNumber: s.dayNumber,
          focus: s.focus,
        })),
      });
      await tx.prescription.createMany({
        data: rev.sessions.flatMap((s) =>
          s.prescriptions.map((p) => ({
            id: p.prescriptionId,
            plannedSessionId: s.plannedSessionId,
            exerciseId: p.exerciseId,
            order: p.order,
            targetSets: p.targetSets,
            targetReps: (p.targetReps ??
              undefined) as unknown as Prisma.InputJsonValue,
            targetWeightKg: p.targetWeightKg ?? null,
            targetDurationSec: p.targetDurationSec ?? null,
            targetDistanceM: p.targetDistanceM ?? null,
            targetPaceSecPerKm: p.targetPaceSecPerKm ?? null,
            targetRpe: p.targetRpe ?? null,
            restSec: p.restSec,
          })),
        ),
      });

      // Interval blocks là bảng con nên phải ghi sau prescription (FK), vẫn
      // trong cùng transaction. Bài đơn giản không có block -> bỏ qua.
      const blocks = rev.sessions.flatMap((s) =>
        s.prescriptions.flatMap((p) =>
          (p.blocks ?? []).map((b) => ({
            prescriptionId: p.prescriptionId,
            order: b.order,
            phase: b.phase as WorkoutBlockPhase,
            durationSec: b.durationSec ?? null,
            distanceM: b.distanceM ?? null,
            targetRpeMin: b.targetRpeMin ?? null,
            targetRpeMax: b.targetRpeMax ?? null,
            targetPaceSecPerKm: b.targetPaceSecPerKm ?? null,
            instruction: b.instruction,
          })),
        ),
      );
      if (blocks.length) {
        await tx.prescriptionBlock.createMany({ data: blocks });
      }
    }, { maxWait: 10_000, timeout: 60_000 });
  }
}
