// session/training-decision.ts
// DETERMINISTIC. Không LLM. §9 — free tier = SAFETY-SCOPE ONLY.
// §9.3 safety override: not_tolerating OR pain_stop mới OR readiness=hold OR follow-up conservative
// -> neverIncreaseLoad=true. File này KHÔNG BAO GIỜ phát ra action tăng tải.

import { MovementToleranceRollup } from './movement-tolerance';
import { ReadinessVerdict } from './tolerance';

export const SafetyAction = {
  HOLD: 'hold',
  REDUCE_VOLUME: 'reduce_volume',
  REGRESS_EXERCISE: 'regress_exercise',
  SUBSTITUTE_EXERCISE: 'substitute_exercise',
  PAUSE_MOVEMENT_PATTERN: 'pause_movement_pattern',
  SUGGEST_PROFESSIONAL_SUPPORT: 'suggest_professional_support',
} as const;
export type SafetyActionCode = (typeof SafetyAction)[keyof typeof SafetyAction];

export interface TrainingDecisionInput {
  movementRollups: MovementToleranceRollup[];
  latestReadinessVerdict: ReadinessVerdict;
  hasNewPainStop: boolean;
  followupRequiresConservative: boolean;
}

export interface SafetyActionItem {
  code: SafetyActionCode;
  scope: 'session' | 'movement_pattern' | 'exercise';
  target?: string;
  reason: string;
}

export interface TrainingDecision {
  actions: SafetyActionItem[];
  safetyOverrideActive: boolean;
  neverIncreaseLoad: boolean;
  ruleVersion: string;
}

const RULE_VERSION = 'training-decision/v4.0';

export function decideTrainingSafety(
  input: TrainingDecisionInput,
): TrainingDecision {
  const notTolerating = input.movementRollups.filter(
    (r) => r.verdict === 'not_tolerating',
  );
  const borderline = input.movementRollups.filter((r) => r.verdict === 'borderline');

  // §9.3 override
  const safetyOverrideActive =
    input.hasNewPainStop ||
    input.latestReadinessVerdict === 'hold' ||
    notTolerating.length > 0 ||
    input.followupRequiresConservative;

  const actions: SafetyActionItem[] = [];

  for (const r of notTolerating) {
    actions.push({
      code: SafetyAction.PAUSE_MOVEMENT_PATTERN,
      scope: 'movement_pattern',
      target: r.movementPattern,
      reason: `Nhóm động tác "${r.movementPattern}" chưa dung nạp được tải — tạm dừng và hạ bậc.`,
    });
    actions.push({
      code: SafetyAction.REGRESS_EXERCISE,
      scope: 'movement_pattern',
      target: r.movementPattern,
      reason: `Dùng biến thể dễ hơn cho "${r.movementPattern}".`,
    });
    // lặp lại nhiều lần -> gợi ý hỗ trợ chuyên môn
    if (r.notToleratedCount >= 2) {
      actions.push({
        code: SafetyAction.SUGGEST_PROFESSIONAL_SUPPORT,
        scope: 'movement_pattern',
        target: r.movementPattern,
        reason: 'Phản ứng bất lợi lặp lại — nên tham khảo chuyên gia.',
      });
    }
  }

  if (input.hasNewPainStop) {
    actions.push({
      code: SafetyAction.HOLD,
      scope: 'session',
      reason: 'Có pain-stop mới — giữ lại và thay/hạ bậc bài liên quan.',
    });
    actions.push({
      code: SafetyAction.SUBSTITUTE_EXERCISE,
      scope: 'session',
      reason: 'Thay bài gây đau bằng bài an toàn hơn.',
    });
  }

  if (input.latestReadinessVerdict === 'hold') {
    actions.push({
      code: SafetyAction.HOLD,
      scope: 'session',
      reason: 'Readiness = hold — giữ buổi.',
    });
  }

  if (
    (borderline.length > 0 || input.followupRequiresConservative) &&
    !input.hasNewPainStop
  ) {
    actions.push({
      code: SafetyAction.REDUCE_VOLUME,
      scope: 'session',
      reason: 'Tín hiệu borderline / phản ứng ngày sau — giảm tải để an toàn.',
    });
  }

  return {
    actions,
    safetyOverrideActive,
    neverIncreaseLoad: safetyOverrideActive,
    ruleVersion: RULE_VERSION,
  };
}
