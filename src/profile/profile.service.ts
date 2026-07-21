// profile/profile.service.ts
// NestJS provider bọc quanh logic thuần. Logic sống trong flags.ts/guardrail.ts
// (pure, dễ test); service chỉ điều phối + gọi Prisma + gọi LLM.

import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Profile, RedFlag } from './profile.types';
import { computeFlags, computeBmi } from './flags';
import { buildGuardrail, GuardrailResult, Exercise } from './guardrail';
import { AdaptationCaps } from './adaptation-phase';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';

export interface ProfileDraftResult {
  profile: Profile;
  flags: RedFlag[];
  bmi: number | null;
}

@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  /** Bước 1: raw text -> profile draft. LLM chỉ TRÍCH (xem onboarding_extraction.md). */
  async extractProfile(rawText: string): Promise<ProfileDraftResult> {
    const draft = await this.llm.extractProfile(rawText); // model rẻ, structured output
    // provenance + số an toàn là CODE, không phải LLM
    const bmi = computeBmi(
      draft.constraint.weightKg,
      draft.constraint.heightCm,
    );
    if (bmi !== null) draft.constraint.bmi = bmi;
    const { flags } = computeFlags(draft);
    return { profile: draft, flags, bmi };
  }

  /** Bước 2: tính flags (CODE, deterministic). Chạy lại sau khi user sửa ở màn xác nhận. */
  computeFlags(profile: Profile): { flags: RedFlag[]; bmi: number | null } {
    return computeFlags(profile);
  }

  /**
   * Lưu profile đã xác nhận: recompute flags/bmi trên bản user đã sửa, upsert UserProfile,
   * append ProfileHistory (append-only snapshot). Trả profile hiện hành.
   */
  async saveProfile(
    userId: string,
    profile: Profile,
    rawOnboarding: string,
  ): Promise<ProfileDraftResult> {
    const { flags, bmi } = computeFlags(profile);
    if (bmi !== null) profile.constraint.bmi = bmi;

    const existing = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { profileVersion: true },
    });
    const nextVersion = (existing?.profileVersion ?? 0) + 1;

    await this.ensureUser(userId);

    await this.prisma.$transaction([
      this.prisma.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          profileVersion: nextVersion,
          rawOnboarding,
          constraint: profile.constraint as unknown as Prisma.InputJsonValue,
          target: profile.target as unknown as Prisma.InputJsonValue,
          redFlags: flags as unknown as Prisma.InputJsonValue,
          bmi,
        },
        update: {
          profileVersion: nextVersion,
          rawOnboarding,
          constraint: profile.constraint as unknown as Prisma.InputJsonValue,
          target: profile.target as unknown as Prisma.InputJsonValue,
          redFlags: flags as unknown as Prisma.InputJsonValue,
          bmi,
        },
      }),
      this.prisma.profileHistory.create({
        data: {
          userId,
          profileVersion: nextVersion,
          snapshot: {
            constraint: profile.constraint,
            target: profile.target,
            redFlags: flags,
            bmi,
          } as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    return { profile, flags, bmi };
  }

  /** Profile hiện hành (đã lưu). */
  async getProfile(userId: string): Promise<ProfileDraftResult> {
    const row = await this.prisma.userProfile.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('Profile chưa được thiết lập');
    const profile: Profile = {
      constraint: row.constraint as unknown as Profile['constraint'],
      target: row.target as unknown as Profile['target'],
    };
    return {
      profile,
      flags: (row.redFlags as unknown as RedFlag[]) ?? [],
      bmi: row.bmi ?? null,
    };
  }

  /**
   * Guardrail: policy + pool đã lọc. library lấy từ Prisma — CHỈ bài reviewedBy != null
   * (đã PT duyệt) mới vào production pool.
   * §2: nếu user có adaptation phase active -> truyền caps để guardrail siết difficulty/impact.
   */
  async buildGuardrail(
    profile: Profile,
    userId?: string,
  ): Promise<GuardrailResult> {
    const rows = await this.prisma.exercise.findMany({
      where: { reviewedBy: { not: null } },
    });
    const library: Exercise[] = rows.map((r) => ({
      exerciseId: r.exerciseId,
      name: r.name,
      exerciseType: r.exerciseType,
      equipment: (r.equipment as unknown as string[]) ?? [],
      difficulty: r.difficulty,
      contraindications:
        (r.contraindications as unknown as {
          injuryArea: string;
          reason?: string;
        }[]) ?? [],
      // extra fields validator/pool may read
      primaryMuscles: (r.primaryMuscles as unknown as string[]) ?? [],
      movementPattern: r.movementPattern ?? undefined,
      goalFit: (r.goalFit as unknown as string[]) ?? [],
      defaultRx: r.defaultRx ?? undefined,
    }));

    const caps = userId ? await this.activeAdaptationCaps(userId) : null;
    return buildGuardrail(profile, library, caps);
  }

  /** caps của adaptation phase active (null nếu không có). */
  private async activeAdaptationCaps(
    userId: string,
  ): Promise<AdaptationCaps | null> {
    const phase = await this.prisma.adaptationPhase.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    if (!phase || phase.difficultyCap == null || phase.impactCap == null) {
      return null;
    }
    return {
      volumeCapPct: phase.volumeCapPct ?? 100,
      difficultyCap: phase.difficultyCap,
      impactCap: phase.impactCap,
    };
  }

  /** Đảm bảo User row tồn tại (Supabase auth tạo user; app-side row tạo lazy). */
  private async ensureUser(userId: string): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });
  }
}
