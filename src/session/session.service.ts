import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  Environment,
  DistanceSource,
  DataSource,
  EnergyLevel,
  FeedbackFlag,
  SessionStatus,
  SessionReadinessStatus,
  ReadinessEnergyLevel,
  ReadinessVerdict,
  ExecutionItemStatus,
  FeedbackEventType,
  FeedbackActionTaken,
  AssessmentStage,
  ToleranceVerdict,
  FollowupStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { computeSessionFeedback, SessionFeedback } from './session-feedback';
import {
  assessReadiness,
  ReadinessResponses,
  ReadinessResult,
  PlannedItem,
} from './readiness';
import {
  buildExecutionSnapshot,
  EffectiveRx,
  PlannedInput,
} from './execution-snapshot';
import { applyPainStop } from './pain-stop';
import {
  assessSessionTolerance,
  DuringSessionSignal,
  SessionToleranceResult,
} from './tolerance';
import { decideFollowup } from './followup';
import type { WorkoutSession, LoggedSet } from './session.types';
import type { LogSessionDto } from './dto/log-session.dto';
import type { CreateSessionDto } from './dto/create-session.dto';
import type { SubmitReadinessDto } from './dto/submit-readiness.dto';
import type { LogSetsDto } from './dto/log-sets.dto';
import type { RecordFeedbackDto } from './dto/record-feedback.dto';

type ExType = 'resistance' | 'cardio' | 'mobility';

export const FOLLOWUP_DUE_QUEUE = 'followup.due';

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly boss: BossService,
  ) {}

  /**
   * Flow B (free, ~$0, KHÔNG LLM): lưu WorkoutSession + LoggedSet[], query prior gần nhất
   * cùng bài, computeSessionFeedback (CODE), cập nhật completionPct, trả feedback ngay.
   */
  async logSession(
    userId: string,
    dto: LogSessionDto,
  ): Promise<{ sessionId: string; feedback: SessionFeedback }> {
    await this.ensureUser(userId);

    const exerciseIds = [...new Set(dto.sets.map((s) => s.exerciseId))];

    // prior: với mỗi bài, các set của LẦN GẦN NHẤT trước đó của user (trước startedAt này)
    const priorByExercise = await this.buildPriorByExercise(
      userId,
      exerciseIds,
      new Date(dto.startedAt),
    );

    // exTypeOf từ movement library
    const exRows = await this.prisma.exercise.findMany({
      where: { exerciseId: { in: exerciseIds } },
      select: { exerciseId: true, exerciseType: true },
    });
    const typeMap = new Map<string, ExType>(
      exRows.map((r) => [r.exerciseId, r.exerciseType as ExType]),
    );
    const exTypeOf = (id: string): ExType => typeMap.get(id) ?? 'resistance';

    // prescribedSetCount từ planned session (nếu log against plan)
    const prescribedSetCount = await this.prescribedSetCount(
      dto.plannedSessionId,
    );

    // persist trong transaction, rồi feedback
    const sessionId = await this.prisma.$transaction(async (tx) => {
      const session = await tx.workoutSession.create({
        data: {
          userId,
          plannedSessionId: dto.plannedSessionId ?? null,
          programRevisionId: dto.programRevisionId,
          environment: (dto.environment as Environment) ?? Environment.unknown,
          distanceSource:
            (dto.distanceSource as DistanceSource) ?? DistanceSource.none,
          dataSource: (dto.dataSource as DataSource) ?? DataSource.manual,
          startedAt: new Date(dto.startedAt),
          endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
          sessionRpe: dto.sessionRpe ?? null,
          energyAfter: (dto.energyAfter as EnergyLevel) ?? null,
          notes: dto.notes ?? null,
          wearable: (dto.wearable ??
            undefined) as unknown as Prisma.InputJsonValue,
        },
      });
      for (const s of dto.sets) {
        await tx.loggedSet.create({
          data: {
            sessionId: session.sessionId,
            prescriptionId: s.prescriptionId ?? null,
            exerciseId: s.exerciseId,
            setNumber: s.setNumber,
            actualReps: s.actualReps ?? null,
            actualWeightKg: s.actualWeightKg ?? null,
            actualDurationSec: s.actualDurationSec ?? null,
            actualDistanceM: s.actualDistanceM ?? null,
            actualPaceSecPerKm: s.actualPaceSecPerKm ?? null,
            stroke: s.stroke ?? null,
            actualRom: s.actualRom ?? null,
            actualRpe: s.actualRpe ?? null,
            feedbackFlag: (s.feedbackFlag as FeedbackFlag) ?? null,
            fieldSources: (s.fieldSources ??
              undefined) as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return session.sessionId;
    });

    // Build the WorkoutSession domain object cho computeSessionFeedback
    const current: WorkoutSession = {
      sessionId,
      userId,
      plannedSessionId: dto.plannedSessionId ?? null,
      programRevisionId: dto.programRevisionId,
      environment: (dto.environment as WorkoutSession['environment']) ?? 'unknown',
      distanceSource:
        (dto.distanceSource as WorkoutSession['distanceSource']) ?? 'none',
      dataSource: (dto.dataSource as WorkoutSession['dataSource']) ?? 'manual',
      startedAt: dto.startedAt,
      endedAt: dto.endedAt ?? null,
      sessionRpe: dto.sessionRpe ?? null,
      energyAfter: (dto.energyAfter as WorkoutSession['energyAfter']) ?? null,
      notes: dto.notes ?? null,
      wearable: null,
      sets: dto.sets.map((s, i) => ({
        setId: `${sessionId}-${i}`,
        sessionId,
        prescriptionId: s.prescriptionId ?? null,
        exerciseId: s.exerciseId,
        setNumber: s.setNumber,
        actualReps: s.actualReps ?? null,
        actualWeightKg: s.actualWeightKg ?? null,
        actualDurationSec: s.actualDurationSec ?? null,
        actualDistanceM: s.actualDistanceM ?? null,
        actualPaceSecPerKm: s.actualPaceSecPerKm ?? null,
        stroke: (s.stroke as LoggedSet['stroke']) ?? null,
        actualRom: s.actualRom ?? null,
        actualRpe: s.actualRpe ?? null,
        feedbackFlag: (s.feedbackFlag as LoggedSet['feedbackFlag']) ?? null,
      })),
    };

    const feedback = computeSessionFeedback(
      current,
      exTypeOf,
      priorByExercise,
      prescribedSetCount,
    );

    // cập nhật completionPct đã tính
    await this.prisma.workoutSession.update({
      where: { sessionId },
      data: { completionPct: feedback.completionPct },
    });

    return { sessionId, feedback };
  }

  async getSession(userId: string, sessionId: string) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { sessionId, userId },
      include: { sets: { orderBy: { setNumber: 'asc' } } },
    });
    if (!session) throw new NotFoundException('Không tìm thấy buổi tập');
    return session;
  }

  async history(userId: string, from?: string, to?: string) {
    const where: Prisma.WorkoutSessionWhereInput = { userId };
    if (from || to) {
      where.startedAt = {};
      if (from) where.startedAt.gte = new Date(from);
      if (to) where.startedAt.lte = new Date(to);
    }
    return this.prisma.workoutSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      include: { sets: true },
    });
  }

  // ==========================================================
  // SESSION SAFETY LOOP (§5) — lifecycle nhiều bước
  // ==========================================================

  /** POST /session/create — tạo vỏ buổi (status=planned). */
  async createSession(
    userId: string,
    dto: CreateSessionDto,
  ): Promise<{ sessionId: string }> {
    await this.ensureUser(userId);
    const session = await this.prisma.workoutSession.create({
      data: {
        userId,
        plannedSessionId: dto.plannedSessionId ?? null,
        programRevisionId: dto.programRevisionId,
        status: SessionStatus.planned,
        startedAt: dto.startedAt ? new Date(dto.startedAt) : new Date(),
      },
    });
    return { sessionId: session.sessionId };
  }

  /**
   * POST /session/:id/readiness — chạy assessReadiness (CODE) rồi lưu.
   * verdict/modifications do engine thuần sinh — KHÔNG LLM.
   */
  async submitReadiness(
    userId: string,
    sessionId: string,
    dto: SubmitReadinessDto,
  ): Promise<ReadinessResult> {
    const session = await this.requireSession(userId, sessionId);
    const planned = await this.loadPlannedItems(session.plannedSessionId);

    const responses: ReadinessResponses = {
      answered: dto.answered,
      discomforts: (dto.discomforts ?? []).map((d) => ({
        bodyArea: d.bodyArea,
        severity: d.severity as 'mild' | 'moderate' | 'severe',
        affectsNormalMovement: d.affectsNormalMovement,
      })),
      residualSoreness:
        (dto.residualSoreness as ReadinessResponses['residualSoreness']) ?? 'none',
      energyLevel: (dto.energyLevel as ReadinessResponses['energyLevel']) ?? 'ok',
      externalLoads: dto.externalLoads ?? null,
    };

    const result = assessReadiness(responses, planned);

    await this.prisma.sessionReadiness.upsert({
      where: { sessionId },
      create: {
        sessionId,
        userId,
        status: dto.answered
          ? SessionReadinessStatus.completed
          : SessionReadinessStatus.skipped,
        currentDiscomforts: responses.discomforts as unknown as Prisma.InputJsonValue,
        residualSoreness: this.mapSoreness(responses.residualSoreness),
        energyLevel: this.mapReadinessEnergy(responses.energyLevel),
        externalLoads: (responses.externalLoads ??
          {}) as unknown as Prisma.InputJsonValue,
        verdict: result.verdict as ReadinessVerdict,
        modifications: result.modifications as unknown as Prisma.InputJsonValue,
        ruleVersion: result.ruleVersion,
      },
      update: {
        status: dto.answered
          ? SessionReadinessStatus.completed
          : SessionReadinessStatus.skipped,
        currentDiscomforts: responses.discomforts as unknown as Prisma.InputJsonValue,
        residualSoreness: this.mapSoreness(responses.residualSoreness),
        energyLevel: this.mapReadinessEnergy(responses.energyLevel),
        externalLoads: (responses.externalLoads ??
          {}) as unknown as Prisma.InputJsonValue,
        verdict: result.verdict as ReadinessVerdict,
        modifications: result.modifications as unknown as Prisma.InputJsonValue,
        ruleVersion: result.ruleVersion,
      },
    });

    return result;
  }

  /**
   * POST /session/:id/execution — dựng snapshot BẤT BIẾN từ prescriptions + readiness (§5.3).
   * effectiveRx là mốc so sánh về sau (không so với plannedRx).
   */
  async buildExecution(userId: string, sessionId: string) {
    const session = await this.requireSession(userId, sessionId);
    if (!session.plannedSessionId) {
      // free workout: không có plan -> không có execution item, không lỗi
      await this.prisma.workoutSession.update({
        where: { sessionId },
        data: { status: SessionStatus.in_progress },
      });
      return { items: [] };
    }

    const readinessRow = await this.prisma.sessionReadiness.findUnique({
      where: { sessionId },
    });
    const readiness: ReadinessResult = readinessRow
      ? {
          verdict: readinessRow.verdict as ReadinessResult['verdict'],
          modifications: (readinessRow.modifications ??
            []) as unknown as ReadinessResult['modifications'],
          ruleVersion: readinessRow.ruleVersion,
        }
      : // chưa submit readiness -> coi như unknown, conservative (an toàn)
        assessReadiness(
          {
            answered: false,
            discomforts: [],
            residualSoreness: 'none',
            energyLevel: 'ok',
            externalLoads: null,
          },
          [],
        );

    const planned = await this.loadPlannedInputs(session.plannedSessionId);
    const patternOf = new Map(planned.map((p) => [p.item.exerciseId, p.item.movementPattern]));

    const resolveRegression = this.makeRegressionResolver();
    const resolveSubstitute = () => null; // v1: chưa có substitution lib -> skip an toàn

    const snapshot = buildExecutionSnapshot(
      planned,
      readiness,
      await resolveRegression,
      resolveSubstitute,
    );

    await this.prisma.$transaction(async (tx) => {
      for (const it of snapshot.items) {
        await tx.sessionExecutionItem.create({
          data: {
            sessionId,
            sourcePrescriptionId: it.prescriptionId,
            originalExerciseId: it.originalExerciseId,
            exerciseId: it.exerciseId,
            movementPattern: patternOf.get(it.originalExerciseId) ?? it.movementPattern,
            order: it.order,
            plannedRx: it.plannedRx as unknown as Prisma.InputJsonValue,
            effectiveRx: it.effectiveRx as unknown as Prisma.InputJsonValue,
            appliedModifications:
              it.appliedModifications as unknown as Prisma.InputJsonValue,
            status: it.status as ExecutionItemStatus,
          },
        });
      }
      await tx.workoutSession.update({
        where: { sessionId },
        data: { status: SessionStatus.in_progress },
      });
    });

    const items = await this.prisma.sessionExecutionItem.findMany({
      where: { sessionId },
      orderBy: { order: 'asc' },
    });
    return { items, ruleVersion: snapshot.ruleVersion };
  }

  /** POST /session/:id/sets — log LoggedSet[] (append-able). */
  async logSets(userId: string, sessionId: string, dto: LogSetsDto) {
    await this.requireSession(userId, sessionId);
    const created = await this.prisma.$transaction(
      dto.sets.map((s) =>
        this.prisma.loggedSet.create({
          data: {
            sessionId,
            executionItemId: s.executionItemId ?? null,
            prescriptionId: s.prescriptionId ?? null,
            movementPattern: s.movementPattern ?? null,
            exerciseId: s.exerciseId,
            setNumber: s.setNumber,
            actualReps: s.actualReps ?? null,
            actualWeightKg: s.actualWeightKg ?? null,
            actualDurationSec: s.actualDurationSec ?? null,
            actualDistanceM: s.actualDistanceM ?? null,
            actualPaceSecPerKm: s.actualPaceSecPerKm ?? null,
            stroke: s.stroke ?? null,
            actualRom: s.actualRom ?? null,
            actualRpe: s.actualRpe ?? null,
            fieldSources: (s.fieldSources ??
              undefined) as unknown as Prisma.InputJsonValue,
          },
        }),
      ),
    );
    return { count: created.length };
  }

  /**
   * POST /session/:id/feedback — ghi một ExerciseFeedbackEvent (§5.5).
   * INVARIANT §12.3: type=pain_stop -> applyPainStop (CODE), set execution item 'stopped',
   * triggeredFollowup=true, KHÔNG BAO GIỜ map thành too_hard.
   * Dual-write: too_easy/too_hard/uncomfortable/ok cũng cập nhật LoggedSet.feedbackFlag (back-compat).
   */
  async recordFeedback(
    userId: string,
    sessionId: string,
    dto: RecordFeedbackDto,
  ): Promise<{ feedbackEventId: string; actionTaken: FeedbackActionTaken }> {
    await this.requireSession(userId, sessionId);

    return this.prisma.$transaction(async (tx) => {
      let actionTaken: FeedbackActionTaken = FeedbackActionTaken.none;
      let triggeredFollowup = false;

      if (dto.type === 'pain_stop') {
        const outcome = applyPainStop({
          executionItemId: dto.executionItemId ?? '',
          bodyArea: dto.bodyArea ?? null,
          spreadsToRelatedPattern: dto.spreadsToRelatedPattern ?? false,
        });
        actionTaken = outcome.actionTaken as FeedbackActionTaken;
        triggeredFollowup = outcome.triggeredFollowup;
        // ép execution item -> stopped
        if (dto.executionItemId) {
          await tx.sessionExecutionItem.update({
            where: { executionItemId: dto.executionItemId },
            data: { status: ExecutionItemStatus.stopped },
          });
        }
      }

      const event = await tx.exerciseFeedbackEvent.create({
        data: {
          sessionId,
          executionItemId: dto.executionItemId ?? null,
          setId: dto.setId ?? null,
          exerciseId: dto.exerciseId,
          movementPattern: dto.movementPattern ?? null,
          type: dto.type as FeedbackEventType,
          bodyArea: dto.bodyArea ?? null,
          severity: dto.severity ?? null,
          notes: dto.notes ?? null,
          actionTaken,
          triggeredFollowup,
        },
      });

      // dual-write back-compat: chỉ các giá trị legacy (pain_stop KHÔNG có tương đương flag)
      if (
        dto.setId &&
        dto.type !== 'pain_stop' &&
        (['too_easy', 'too_hard', 'uncomfortable', 'ok'] as const).includes(
          dto.type as 'too_easy' | 'too_hard' | 'uncomfortable' | 'ok',
        )
      ) {
        await tx.loggedSet.update({
          where: { setId: dto.setId },
          data: { feedbackFlag: dto.type as FeedbackFlag },
        });
      }

      return { feedbackEventId: event.feedbackEventId, actionTaken };
    });
  }

  /**
   * POST /session/:id/complete — kết buổi (§14.4):
   *   computeSessionFeedback (prescribedSetCount = SUM effectiveRx.targetSets) +
   *   immediate tolerance assessment + decideFollowup -> schedule pg-boss (nếu cần).
   */
  async completeSession(
    userId: string,
    sessionId: string,
  ): Promise<{
    feedback: SessionFeedback;
    tolerance: SessionToleranceResult;
    followupScheduled: boolean;
  }> {
    const session = await this.requireSession(userId, sessionId);

    const sets = await this.prisma.loggedSet.findMany({
      where: { sessionId },
      orderBy: { setNumber: 'asc' },
    });
    const execItems = await this.prisma.sessionExecutionItem.findMany({
      where: { sessionId },
    });
    const exerciseIds = [...new Set(sets.map((s) => s.exerciseId))];

    // feedback (code thuần)
    const priorByExercise = await this.buildPriorByExercise(
      userId,
      exerciseIds,
      session.startedAt,
    );
    const exRows = await this.prisma.exercise.findMany({
      where: { exerciseId: { in: exerciseIds } },
      select: { exerciseId: true, exerciseType: true },
    });
    const typeMap = new Map<string, ExType>(
      exRows.map((r) => [r.exerciseId, r.exerciseType as ExType]),
    );
    const exTypeOf = (id: string): ExType => typeMap.get(id) ?? 'resistance';

    // §5.3: prescribedSetCount so với effectiveRx (không so plannedRx / raw prescription)
    const prescribedSetCount = execItems.length
      ? execItems.reduce((a, it) => {
          const eff = (it.effectiveRx ?? {}) as { targetSets?: number };
          return a + (eff.targetSets ?? 0);
        }, 0)
      : await this.prescribedSetCount(session.plannedSessionId);

    const current = this.toDomainSession(session, sets);
    const feedback = computeSessionFeedback(
      current,
      exTypeOf,
      priorByExercise,
      prescribedSetCount,
    );

    // immediate tolerance từ feedback events
    const events = await this.prisma.exerciseFeedbackEvent.findMany({
      where: { sessionId },
    });
    const during = this.duringSignal(events, sets.length, prescribedSetCount);
    const readinessRow = await this.prisma.sessionReadiness.findUnique({
      where: { sessionId },
    });
    const readinessVerdict =
      (readinessRow?.verdict as SessionToleranceResult['perPattern'][number]['verdict']) ??
      'ready';
    const movementPatterns = [
      ...new Set(
        execItems
          .map((e) => e.movementPattern)
          .filter((p): p is string => !!p),
      ),
    ];
    const tolerance = assessSessionTolerance({
      readiness: { verdict: (readinessRow?.verdict as 'ready') ?? 'ready' },
      during,
      delayed: null,
      movementPatterns,
    });

    await this.prisma.sessionToleranceAssessment.upsert({
      where: {
        sessionId_assessmentStage: {
          sessionId,
          assessmentStage: AssessmentStage.immediate,
        },
      },
      create: {
        sessionId,
        assessmentStage: AssessmentStage.immediate,
        duringSessionSignal: during as unknown as Prisma.InputJsonValue,
        sessionToleranceVerdict: this.mapToleranceVerdict(tolerance.verdict),
        affectedPatterns: movementPatterns as unknown as Prisma.InputJsonValue,
        ruleVersion: tolerance.ruleVersion,
      },
      update: {
        duringSessionSignal: during as unknown as Prisma.InputJsonValue,
        sessionToleranceVerdict: this.mapToleranceVerdict(tolerance.verdict),
        affectedPatterns: movementPatterns as unknown as Prisma.InputJsonValue,
        ruleVersion: tolerance.ruleVersion,
      },
    });

    // completionPct + status
    await this.prisma.workoutSession.update({
      where: { sessionId },
      data: { completionPct: feedback.completionPct, status: SessionStatus.completed },
    });

    // decideFollowup -> schedule
    const firstExposurePatterns = await this.firstExposurePatterns(
      userId,
      movementPatterns,
      sessionId,
    );
    const decision = decideFollowup({
      adaptationActive: false, // Phase 3 nối adaptation vào đây
      firstExposurePatterns,
      during,
      readinessVerdict: readinessVerdict as 'ready',
    });

    let followupScheduled = false;
    if (decision.schedule) {
      const scheduledFor = new Date(
        session.startedAt.getTime() + decision.delayHours * 3600_000,
      );
      const followup = await this.prisma.postSessionFollowup.create({
        data: {
          userId,
          sourceSessionId: sessionId,
          status: FollowupStatus.scheduled,
          triggerReasons: decision.triggers as unknown as Prisma.InputJsonValue,
          scheduledFor,
          ruleVersion: decision.ruleVersion,
        },
      });
      await this.boss.enqueue(
        FOLLOWUP_DUE_QUEUE,
        { followupId: followup.followupId },
        { startAfter: scheduledFor },
      );
      followupScheduled = true;
    }

    return { feedback, tolerance, followupScheduled };
  }

  // ---- helpers ----

  private toDomainSession(
    session: {
      sessionId: string;
      userId: string;
      plannedSessionId: string | null;
      programRevisionId: string;
      startedAt: Date;
      endedAt: Date | null;
      sessionRpe: number | null;
    },
    sets: {
      setId: string;
      prescriptionId: string | null;
      exerciseId: string;
      setNumber: number;
      actualReps: number | null;
      actualWeightKg: number | null;
      actualDurationSec: number | null;
      actualDistanceM: number | null;
      actualPaceSecPerKm: number | null;
      stroke: string | null;
      actualRom: string | null;
      actualRpe: number | null;
    }[],
  ): WorkoutSession {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      plannedSessionId: session.plannedSessionId,
      programRevisionId: session.programRevisionId,
      environment: 'unknown',
      distanceSource: 'none',
      dataSource: 'manual',
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      sessionRpe: session.sessionRpe,
      energyAfter: null,
      notes: null,
      wearable: null,
      sets: sets.map((s) => ({
        setId: s.setId,
        sessionId: session.sessionId,
        prescriptionId: s.prescriptionId,
        exerciseId: s.exerciseId,
        setNumber: s.setNumber,
        actualReps: s.actualReps,
        actualWeightKg: s.actualWeightKg,
        actualDurationSec: s.actualDurationSec,
        actualDistanceM: s.actualDistanceM,
        actualPaceSecPerKm: s.actualPaceSecPerKm,
        stroke: s.stroke as LoggedSet['stroke'],
        actualRom: s.actualRom,
        actualRpe: s.actualRpe,
      })),
    };
  }

  private duringSignal(
    events: { type: string }[],
    setsLogged: number,
    prescribedSetCount: number,
  ): DuringSessionSignal {
    const count = (t: string) => events.filter((e) => e.type === t).length;
    const completedRatio =
      prescribedSetCount > 0
        ? Math.min(1, setsLogged / prescribedSetCount)
        : 1;
    return {
      painStops: count('pain_stop'),
      tooHard: count('too_hard'),
      uncomfortable: count('uncomfortable'),
      tooEasy: count('too_easy'),
      completedRatio,
    };
  }

  private mapToleranceVerdict(v: SessionToleranceResult['verdict']): ToleranceVerdict {
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

  /** pattern lần đầu xuất hiện (chưa có exposure tolerated ở buổi trước). */
  private async firstExposurePatterns(
    userId: string,
    patterns: string[],
    excludeSessionId: string,
  ): Promise<string[]> {
    const out: string[] = [];
    for (const p of patterns) {
      const prior = await this.prisma.sessionExecutionItem.findFirst({
        where: {
          movementPattern: p,
          sessionId: { not: excludeSessionId },
          session: { userId },
        },
        select: { executionItemId: true },
      });
      if (!prior) out.push(p);
    }
    return out;
  }

  private async requireSession(userId: string, sessionId: string) {
    const session = await this.prisma.workoutSession.findFirst({
      where: { sessionId, userId },
    });
    if (!session) throw new NotFoundException('Không tìm thấy buổi tập');
    return session;
  }

  private mapSoreness(
    s: ReadinessResponses['residualSoreness'],
  ): 'none' | 'mild' | 'moderate' | 'severe' {
    // readiness dùng 'high'; enum DB dùng 'severe'
    if (s === 'high') return 'severe';
    return (s ?? 'none') as 'none' | 'mild' | 'moderate';
  }

  private mapReadinessEnergy(
    e: ReadinessResponses['energyLevel'],
  ): ReadinessEnergyLevel {
    if (e === 'low') return ReadinessEnergyLevel.low;
    if (e === 'high') return ReadinessEnergyLevel.high;
    return ReadinessEnergyLevel.normal; // 'ok' | null -> normal
  }

  /** load planned items (pattern + bodyAreas) cho readiness scoping. */
  private async loadPlannedItems(
    plannedSessionId?: string | null,
  ): Promise<PlannedItem[]> {
    if (!plannedSessionId) return [];
    const rx = await this.prisma.prescription.findMany({
      where: { plannedSessionId },
      orderBy: { order: 'asc' },
    });
    const exIds = [...new Set(rx.map((r) => r.exerciseId))];
    const exRows = await this.prisma.exercise.findMany({
      where: { exerciseId: { in: exIds } },
      select: { exerciseId: true, movementPattern: true, contraindications: true },
    });
    const meta = new Map(exRows.map((e) => [e.exerciseId, e]));
    return rx.map((r) => {
      const m = meta.get(r.exerciseId);
      const contra = (m?.contraindications ?? []) as { injuryArea?: string }[];
      const bodyAreas = contra
        .map((c) => c.injuryArea)
        .filter((a): a is string => !!a);
      return {
        prescriptionId: r.prescriptionId,
        exerciseId: r.exerciseId,
        movementPattern: m?.movementPattern ?? 'unknown',
        bodyAreas,
      };
    });
  }

  /** load planned inputs (kèm rx) cho execution snapshot. */
  private async loadPlannedInputs(
    plannedSessionId: string,
  ): Promise<PlannedInput[]> {
    const rx = await this.prisma.prescription.findMany({
      where: { plannedSessionId },
      orderBy: { order: 'asc' },
    });
    const items = await this.loadPlannedItems(plannedSessionId);
    const itemById = new Map(items.map((i) => [i.prescriptionId, i]));
    return rx.map((r) => {
      const effectiveRx: EffectiveRx = {
        targetSets: r.targetSets,
        targetReps: (r.targetReps ?? null) as EffectiveRx['targetReps'],
        targetWeightKg: r.targetWeightKg,
        targetDurationSec: r.targetDurationSec,
        targetDistanceM: r.targetDistanceM,
        targetRpe: r.targetRpe,
        restSec: r.restSec,
      };
      return {
        item: itemById.get(r.prescriptionId)!,
        order: r.order,
        rx: effectiveRx,
      };
    });
  }

  /** resolver regression: đọc Exercise.regressionOf. Trả hàm sync (đã prefetch không cần ở v1). */
  private async makeRegressionResolver() {
    return (exerciseId: string): string | null => {
      // v1: chưa prefetch — regression resolve lười; trả null (giữ nguyên bài) an toàn.
      // (execution-snapshot xử lý null = giữ nguyên id.)
      void exerciseId;
      return null;
    };
  }

  private async buildPriorByExercise(
    userId: string,
    exerciseIds: string[],
    before: Date,
  ): Promise<Map<string, LoggedSet[]>> {
    const result = new Map<string, LoggedSet[]>();
    for (const exId of exerciseIds) {
      // buổi gần nhất trước `before` có log bài này
      const prevSet = await this.prisma.loggedSet.findFirst({
        where: {
          exerciseId: exId,
          session: { userId, startedAt: { lt: before } },
        },
        orderBy: { session: { startedAt: 'desc' } },
        select: { sessionId: true },
      });
      if (!prevSet) {
        result.set(exId, []);
        continue;
      }
      const sets = await this.prisma.loggedSet.findMany({
        where: { sessionId: prevSet.sessionId, exerciseId: exId },
        orderBy: { setNumber: 'asc' },
      });
      result.set(
        exId,
        sets.map((s) => ({
          setId: s.setId,
          sessionId: s.sessionId,
          prescriptionId: s.prescriptionId,
          exerciseId: s.exerciseId,
          setNumber: s.setNumber,
          actualReps: s.actualReps,
          actualWeightKg: s.actualWeightKg,
          actualDurationSec: s.actualDurationSec,
          actualDistanceM: s.actualDistanceM,
          actualPaceSecPerKm: s.actualPaceSecPerKm,
          stroke: s.stroke as LoggedSet['stroke'],
          actualRom: s.actualRom,
          actualRpe: s.actualRpe,
          feedbackFlag: s.feedbackFlag as LoggedSet['feedbackFlag'],
        })),
      );
    }
    return result;
  }

  private async prescribedSetCount(
    plannedSessionId?: string | null,
  ): Promise<number> {
    if (!plannedSessionId) return 0;
    const rx = await this.prisma.prescription.findMany({
      where: { plannedSessionId },
      select: { targetSets: true },
    });
    return rx.reduce((a, p) => a + p.targetSets, 0);
  }

  private async ensureUser(userId: string): Promise<void> {
    await this.prisma.user.upsert({
      where: { id: userId },
      create: { id: userId },
      update: {},
    });
  }
}
