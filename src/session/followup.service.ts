import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  Prisma,
  AssessmentStage,
  ToleranceVerdict,
  FollowupStatus,
  MovementToleranceVerdict,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { ProgramService } from '../program/program.service';
import { FOLLOWUP_DUE_QUEUE } from './session.service';
import { processFollowupReactions } from './followup';
import {
  assessSessionTolerance,
  DuringSessionSignal,
  SessionToleranceResult,
} from './tolerance';
import {
  rollupMovementTolerance,
  PatternExposure,
  MovementToleranceRollup,
} from './movement-tolerance';
import { decideTrainingSafety } from './training-decision';
import type { CompleteFollowupDto } from './dto/complete-followup.dto';

const TOLERANCE_WINDOW_DAYS = 28;

/**
 * §5.6/§8/§9 — vòng an toàn ngày-hôm-sau (KHÔNG LLM):
 *   reactions -> final tolerance -> recompute MovementToleranceRollup ->
 *   decideTrainingSafety -> safety revision (nếu cần, kể cả static program §11).
 * pg-boss worker (delayed) + cron sweep hết hạn.
 */
@Injectable()
export class FollowupService implements OnModuleInit {
  private readonly logger = new Logger(FollowupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly boss: BossService,
    private readonly programService: ProgramService,
  ) {}

  async onModuleInit(): Promise<void> {
    // worker: khi follow-up đến hạn -> flip scheduled -> sent (chờ user trả lời)
    await this.boss.registerWorker<{ followupId: string }>(
      FOLLOWUP_DUE_QUEUE,
      async (jobs) => {
        for (const job of jobs) {
          await this.prisma.postSessionFollowup.updateMany({
            where: {
              id: job.data.followupId,
              status: FollowupStatus.scheduled,
            },
            data: { status: FollowupStatus.sent },
          });
        }
      },
    );
  }

  /** POST /followup/:id/complete — user trả lời phản ứng ngày sau. */
  async complete(userId: string, followupId: string, dto: CompleteFollowupDto) {
    const followup = await this.prisma.postSessionFollowup.findFirst({
      where: { id: followupId, userId },
    });
    if (!followup) throw new NotFoundException('Không tìm thấy follow-up');

    const outcome = processFollowupReactions({
      feelWorse: dto.feelWorse,
      newPainAppeared: dto.newPainAppeared,
      sorenessLingering: dto.sorenessLingering,
      recoveredWell: dto.recoveredWell,
    });

    const sessionId = followup.sourceSessionId;

    // final tolerance: fold delayed vào immediate signal
    const immediate = await this.prisma.sessionToleranceAssessment.findUnique({
      where: {
        sessionId_assessmentStage: {
          sessionId,
          assessmentStage: AssessmentStage.immediate,
        },
      },
    });
    const during = (immediate?.duringSessionSignal ?? {
      painStops: 0,
      tooHard: 0,
      uncomfortable: 0,
      tooEasy: 0,
      completedRatio: 1,
    }) as unknown as DuringSessionSignal;
    const readinessRow = await this.prisma.sessionReadiness.findUnique({
      where: { sessionId },
    });
    const execItems = await this.prisma.sessionExecutionItem.findMany({
      where: { sessionId },
      select: { movementPattern: true },
    });
    const movementPatterns = [
      ...new Set(
        execItems.map((e) => e.movementPattern).filter((p): p is string => !!p),
      ),
    ];

    const finalTolerance: SessionToleranceResult = assessSessionTolerance({
      readiness: { verdict: (readinessRow?.verdict as 'ready') ?? 'ready' },
      during,
      delayed: outcome.delayedSignal,
      movementPatterns,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.postSessionFollowup.update({
        where: { id: followupId },
        data: {
          status: FollowupStatus.completed,
          completedAt: new Date(),
          reactions: [dto] as unknown as Prisma.InputJsonValue,
          requiresConservativeAction: outcome.requiresConservativeAction,
        },
      });
      await tx.sessionToleranceAssessment.upsert({
        where: {
          sessionId_assessmentStage: {
            sessionId,
            assessmentStage: AssessmentStage.final_after_followup,
          },
        },
        create: {
          sessionId,
          assessmentStage: AssessmentStage.final_after_followup,
          duringSessionSignal: during as unknown as Prisma.InputJsonValue,
          delayedSignal: outcome.delayedSignal as unknown as Prisma.InputJsonValue,
          sessionToleranceVerdict: this.mapVerdict(finalTolerance.verdict),
          affectedPatterns: movementPatterns as unknown as Prisma.InputJsonValue,
          ruleVersion: finalTolerance.ruleVersion,
        },
        update: {
          delayedSignal: outcome.delayedSignal as unknown as Prisma.InputJsonValue,
          sessionToleranceVerdict: this.mapVerdict(finalTolerance.verdict),
          ruleVersion: finalTolerance.ruleVersion,
        },
      });
    });

    // recompute movement tolerance rollup từ tất cả final assessments của user
    const rollups = await this.recomputeMovementRollups(userId);

    // safety decision
    const decision = decideTrainingSafety({
      movementRollups: rollups,
      latestReadinessVerdict: (readinessRow?.verdict as 'ready') ?? 'ready',
      hasNewPainStop: during.painStops > 0,
      followupRequiresConservative: outcome.requiresConservativeAction,
    });

    await this.prisma.trainingDecision.create({
      data: {
        userId,
        sessionId,
        scope: 'safety',
        readinessVerdict: readinessRow?.verdict ?? null,
        actions: decision.actions as unknown as Prisma.InputJsonValue,
        safetyOverrideActive: decision.safetyOverrideActive,
        neverIncreaseLoad: decision.neverIncreaseLoad,
        evidenceRefs: [{ sessionId, followupId }] as unknown as Prisma.InputJsonValue,
        ruleVersion: decision.ruleVersion,
      },
    });

    // §11: safety revision cho FREE static program nếu có action an toàn
    let revised = false;
    if (decision.actions.length) {
      revised = await this.programService.reviseForSafety(userId, {
        reason: decision.actions.map((a) => a.reason).join(' '),
      });
    }

    return { tolerance: finalTolerance, decision, revised };
  }

  /** cron: hết hạn follow-up quá hạn mà chưa trả lời (belt-and-suspenders). */
  @Cron(CronExpression.EVERY_HOUR)
  async expireOverdue(): Promise<void> {
    const cutoff = new Date(Date.now() - 48 * 3600_000); // quá hạn 48h -> expired
    const res = await this.prisma.postSessionFollowup.updateMany({
      where: {
        status: { in: [FollowupStatus.scheduled, FollowupStatus.sent] },
        scheduledFor: { lt: cutoff },
      },
      data: { status: FollowupStatus.expired },
    });
    if (res.count) this.logger.log(`Đã hết hạn ${res.count} follow-up quá hạn`);
  }

  // ---- helpers ----

  private mapVerdict(v: SessionToleranceResult['verdict']): ToleranceVerdict {
    switch (v) {
      case 'well_tolerated':
        return ToleranceVerdict.well_tolerated;
      case 'tolerated':
        return ToleranceVerdict.tolerated;
      case 'borderline':
        return ToleranceVerdict.borderline;
      case 'not_tolerated':
        return ToleranceVerdict.not_tolerated;
      default:
        return ToleranceVerdict.pending;
    }
  }

  private mapRollupVerdict(v: MovementToleranceRollup['verdict']): MovementToleranceVerdict {
    switch (v) {
      case 'tolerating':
        return MovementToleranceVerdict.tolerating;
      case 'borderline':
        return MovementToleranceVerdict.borderline;
      case 'not_tolerating':
        return MovementToleranceVerdict.not_tolerating;
      default:
        return MovementToleranceVerdict.insufficient_data;
    }
  }

  /** recompute MovementToleranceRollup từ final assessments trong cửa sổ, upsert. */
  private async recomputeMovementRollups(
    userId: string,
  ): Promise<MovementToleranceRollup[]> {
    const windowStart = new Date(Date.now() - TOLERANCE_WINDOW_DAYS * 86400_000);
    const assessments = await this.prisma.sessionToleranceAssessment.findMany({
      where: {
        assessmentStage: AssessmentStage.final_after_followup,
        calculatedAt: { gte: windowStart },
        session: { userId },
      },
      select: {
        sessionToleranceVerdict: true,
        affectedPatterns: true,
        calculatedAt: true,
      },
    });

    const exposures: PatternExposure[] = [];
    for (const a of assessments) {
      const patterns = (a.affectedPatterns ?? []) as string[];
      for (const p of patterns) {
        exposures.push({
          movementPattern: p,
          sessionToleranceVerdict: this.fromDbVerdict(a.sessionToleranceVerdict),
          stage: 'final_after_followup',
          at: a.calculatedAt.toISOString(),
        });
      }
    }

    const rollups = rollupMovementTolerance(exposures);
    const windowEnd = new Date();
    for (const r of rollups) {
      await this.prisma.movementToleranceRollup.upsert({
        where: {
          userId_movementPattern_windowStart: {
            userId,
            movementPattern: r.movementPattern,
            windowStart,
          },
        },
        create: {
          userId,
          movementPattern: r.movementPattern,
          windowStart,
          windowEnd,
          exposureCount: r.exposures,
          toleratedExposureCount: r.toleratedCount,
          borderlineExposureCount: r.borderlineCount,
          notToleratedExposureCount: r.notToleratedCount,
          consecutiveTolerated: r.consecutiveTolerated,
          toleranceVerdict: this.mapRollupVerdict(r.verdict),
          calculationVersion: 'movement-tolerance/v4.0',
        },
        update: {
          windowEnd,
          exposureCount: r.exposures,
          toleratedExposureCount: r.toleratedCount,
          borderlineExposureCount: r.borderlineCount,
          notToleratedExposureCount: r.notToleratedCount,
          consecutiveTolerated: r.consecutiveTolerated,
          toleranceVerdict: this.mapRollupVerdict(r.verdict),
          calculatedAt: windowEnd,
        },
      });
    }
    return rollups;
  }

  private fromDbVerdict(v: ToleranceVerdict): PatternExposure['sessionToleranceVerdict'] {
    switch (v) {
      case ToleranceVerdict.well_tolerated:
        return 'well_tolerated';
      case ToleranceVerdict.tolerated:
        return 'tolerated';
      case ToleranceVerdict.borderline:
        return 'borderline';
      case ToleranceVerdict.not_tolerated:
        return 'not_tolerated';
      default:
        return 'unknown';
    }
  }
}
