// session/execution-snapshot.ts
// DETERMINISTIC. Không LLM. §5.3 — snapshot BẤT BIẾN của bài user THỰC SỰ được yêu cầu làm
// sau khi áp readiness modifications. progress/tolerance so với effectiveRx, KHÔNG so với plannedRx.
// Sau khi tạo, chỉ status được đổi (planned->stopped/skipped) — do pain-stop rule sở hữu.

import {
  ReadinessResult,
  ReadinessMod,
  PlannedItem,
} from './readiness';

export interface EffectiveRx {
  targetSets: number;
  targetReps?: number | [number, number] | null;
  targetWeightKg?: number | null;
  targetDurationSec?: number | null;
  targetDistanceM?: number | null;
  targetRpe?: number | null;
  restSec: number;
}

export interface ExecutionItem {
  prescriptionId: string;
  exerciseId: string; // có thể khác planned nếu bị substitute
  originalExerciseId: string; // exercise trước khi đổi
  movementPattern: string;
  order: number;
  plannedRx: EffectiveRx;
  effectiveRx: EffectiveRx; // SAU modifications
  status: 'planned' | 'skipped' | 'held';
  appliedModifications: string[]; // ReadinessModCode[] đã áp
}

export type RegressionResolver = (exerciseId: string) => string | null;
export type SubstituteResolver = (
  item: PlannedItem,
  avoidBodyAreas: string[],
) => string | null;

export interface PlannedInput {
  item: PlannedItem;
  order: number;
  rx: EffectiveRx;
}

export interface ExecutionSnapshotResult {
  items: ExecutionItem[];
  ruleVersion: string;
}

const RULE_VERSION = 'execution/v4.0';

function reduceVolume(rx: EffectiveRx, pct: number): EffectiveRx {
  return { ...rx, targetSets: Math.max(1, Math.round((rx.targetSets * pct) / 100)) };
}

/**
 * @param planned    các item đã kê (kèm rx target ban đầu)
 * @param readiness  kết quả assessReadiness (verdict + modifications)
 * @param resolveRegression  exerciseId -> biến thể dễ hơn (hoặc null)
 * @param resolveSubstitute  chọn bài thay tránh vùng đau (hoặc null)
 */
export function buildExecutionSnapshot(
  planned: PlannedInput[],
  readiness: ReadinessResult,
  resolveRegression: RegressionResolver,
  resolveSubstitute: SubstituteResolver,
): ExecutionSnapshotResult {
  const mods = readiness.modifications;
  const holdSession = mods.some((m) => m.code === ReadinessMod.HOLD_SESSION);
  const heldPatterns = new Set(
    mods
      .filter((m) => m.code === ReadinessMod.HOLD_MOVEMENT_PATTERN)
      .map((m) => m.target)
      .filter((t): t is string => !!t),
  );
  const avoidAreas = mods
    .filter((m) => m.code === ReadinessMod.AVOID_BODY_AREA)
    .map((m) => m.target)
    .filter((t): t is string => !!t);
  const sessionVolumeCap = mods
    .filter(
      (m) =>
        m.code === ReadinessMod.REDUCE_VOLUME &&
        m.scope === 'session' &&
        typeof m.payload?.volumeCapPct === 'number',
    )
    .map((m) => m.payload!.volumeCapPct as number)
    .reduce((min, pct) => Math.min(min, pct), 100); // cap chặt nhất thắng

  const items: ExecutionItem[] = [];
  for (const { item, order, rx } of planned) {
    const applied: string[] = [];
    let status: ExecutionItem['status'] = 'planned';
    let exerciseId = item.exerciseId;
    let effectiveRx: EffectiveRx = { ...rx };

    // hold cả buổi / hold pattern -> held
    if (holdSession) {
      status = 'held';
      applied.push(ReadinessMod.HOLD_SESSION);
    } else if (heldPatterns.has(item.movementPattern)) {
      status = 'held';
      applied.push(ReadinessMod.HOLD_MOVEMENT_PATTERN);
    }

    if (status !== 'held') {
      // per-exercise mods (substitute / regression) nhắm đúng exerciseId
      const subMod = mods.find(
        (m) =>
          m.code === ReadinessMod.SUBSTITUTE_EXERCISE &&
          m.scope === 'exercise' &&
          m.target === item.exerciseId,
      );
      const regMod = mods.find(
        (m) =>
          m.code === ReadinessMod.USE_REGRESSION &&
          m.scope === 'exercise' &&
          m.target === item.exerciseId,
      );
      const removeMod = mods.find(
        (m) =>
          m.code === ReadinessMod.REMOVE_EXERCISE &&
          m.scope === 'exercise' &&
          m.target === item.exerciseId,
      );

      if (removeMod) {
        status = 'skipped';
        applied.push(ReadinessMod.REMOVE_EXERCISE);
      } else if (subMod) {
        const sub = resolveSubstitute(item, avoidAreas);
        if (sub) {
          exerciseId = sub;
          applied.push(ReadinessMod.SUBSTITUTE_EXERCISE);
        } else {
          // không có bài thay hợp lệ -> lùi về regression, cuối cùng skip cho an toàn
          const reg = resolveRegression(item.exerciseId);
          if (reg) {
            exerciseId = reg;
            applied.push(ReadinessMod.USE_REGRESSION);
          } else {
            status = 'skipped';
            applied.push(ReadinessMod.REMOVE_EXERCISE);
          }
        }
      } else if (regMod) {
        const reg = resolveRegression(item.exerciseId);
        if (reg) {
          exerciseId = reg;
        }
        applied.push(ReadinessMod.USE_REGRESSION);
      }

      // giảm volume toàn buổi
      if (sessionVolumeCap < 100 && status !== 'skipped') {
        effectiveRx = reduceVolume(effectiveRx, sessionVolumeCap);
        applied.push(ReadinessMod.REDUCE_VOLUME);
      }
    }

    items.push({
      prescriptionId: item.prescriptionId,
      exerciseId,
      originalExerciseId: item.exerciseId,
      movementPattern: item.movementPattern,
      order,
      plannedRx: { ...rx },
      effectiveRx,
      status,
      appliedModifications: applied,
    });
  }

  return { items, ruleVersion: RULE_VERSION };
}
