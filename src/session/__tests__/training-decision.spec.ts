import { decideTrainingSafety, TrainingDecisionInput, SafetyAction } from '../training-decision';
import { MovementToleranceRollup } from '../movement-tolerance';

const rollup = (
  pattern: string,
  verdict: MovementToleranceRollup['verdict'],
  notToleratedCount = 0,
): MovementToleranceRollup => ({
  movementPattern: pattern,
  exposures: 3,
  toleratedCount: 1,
  borderlineCount: 0,
  notToleratedCount,
  consecutiveTolerated: 0,
  verdict,
});

const input = (over: Partial<TrainingDecisionInput> = {}): TrainingDecisionInput => ({
  movementRollups: [],
  latestReadinessVerdict: 'ready',
  hasNewPainStop: false,
  followupRequiresConservative: false,
  ...over,
});

describe('decideTrainingSafety (§9.3 override)', () => {
  it('not_tolerating -> neverIncreaseLoad', () => {
    const d = decideTrainingSafety(
      input({ movementRollups: [rollup('squat', 'not_tolerating')] }),
    );
    expect(d.neverIncreaseLoad).toBe(true);
    expect(d.safetyOverrideActive).toBe(true);
  });

  it('pain_stop mới -> neverIncreaseLoad', () => {
    expect(decideTrainingSafety(input({ hasNewPainStop: true })).neverIncreaseLoad).toBe(true);
  });

  it('readiness=hold -> neverIncreaseLoad', () => {
    expect(
      decideTrainingSafety(input({ latestReadinessVerdict: 'hold' })).neverIncreaseLoad,
    ).toBe(true);
  });

  it('follow-up conservative -> neverIncreaseLoad', () => {
    expect(
      decideTrainingSafety(input({ followupRequiresConservative: true })).neverIncreaseLoad,
    ).toBe(true);
  });

  it('sạch -> không override, không action', () => {
    const d = decideTrainingSafety(input());
    expect(d.safetyOverrideActive).toBe(false);
    expect(d.actions).toHaveLength(0);
  });

  it('not_tolerating -> PAUSE_MOVEMENT_PATTERN', () => {
    const d = decideTrainingSafety(
      input({ movementRollups: [rollup('squat', 'not_tolerating')] }),
    );
    expect(d.actions.some((a) => a.code === SafetyAction.PAUSE_MOVEMENT_PATTERN)).toBe(true);
  });

  it('not_tolerated lặp lại (>=2) -> SUGGEST_PROFESSIONAL_SUPPORT', () => {
    const d = decideTrainingSafety(
      input({ movementRollups: [rollup('squat', 'not_tolerating', 2)] }),
    );
    expect(d.actions.some((a) => a.code === SafetyAction.SUGGEST_PROFESSIONAL_SUPPORT)).toBe(true);
  });

  it('safety-only: KHÔNG BAO GIỜ có action tăng tải', () => {
    const d = decideTrainingSafety(
      input({
        movementRollups: [rollup('squat', 'not_tolerating'), rollup('hinge', 'borderline')],
        hasNewPainStop: true,
        latestReadinessVerdict: 'hold',
        followupRequiresConservative: true,
      }),
    );
    // không action code nào mang nghĩa "tăng" — kiểm trên code, không trên field name
    const codes = d.actions.map((a) => a.code);
    for (const c of codes) expect(c).not.toMatch(/increase/i);
    expect(codes).not.toContain('increase_one_variable');
  });
});
