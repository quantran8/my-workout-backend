import {
  decideFollowup,
  processFollowupReactions,
  FollowupDecisionInput,
  FollowupTrigger,
} from '../followup';
import { DuringSessionSignal } from '../tolerance';

const during = (over: Partial<DuringSessionSignal> = {}): DuringSessionSignal => ({
  painStops: 0,
  tooHard: 0,
  uncomfortable: 0,
  tooEasy: 0,
  completedRatio: 1,
  ...over,
});

const input = (over: Partial<FollowupDecisionInput> = {}): FollowupDecisionInput => ({
  adaptationActive: false,
  firstExposurePatterns: [],
  during: during(),
  readinessVerdict: 'ready',
  ...over,
});

describe('decideFollowup', () => {
  it('không trigger -> không schedule', () => {
    const r = decideFollowup(input());
    expect(r.schedule).toBe(false);
    expect(r.triggers).toHaveLength(0);
  });

  it('mỗi trigger độc lập -> schedule=true', () => {
    expect(decideFollowup(input({ adaptationActive: true })).triggers).toContain(
      FollowupTrigger.ADAPTATION_PHASE,
    );
    expect(
      decideFollowup(input({ firstExposurePatterns: ['hinge'] })).triggers,
    ).toContain(FollowupTrigger.FIRST_EXPOSURE_TO_PATTERN);
    expect(decideFollowup(input({ during: during({ painStops: 1 }) })).triggers).toContain(
      FollowupTrigger.PAIN_STOP_FEEDBACK,
    );
    expect(decideFollowup(input({ during: during({ tooHard: 1 }) })).triggers).toContain(
      FollowupTrigger.TOO_HARD_FEEDBACK,
    );
    expect(
      decideFollowup(input({ during: during({ uncomfortable: 1 }) })).triggers,
    ).toContain(FollowupTrigger.UNCOMFORTABLE_FEEDBACK);
    expect(decideFollowup(input({ readinessVerdict: 'hold' })).triggers).toContain(
      FollowupTrigger.READINESS_MODIFY_OR_HOLD,
    );
    expect(decideFollowup(input({ readinessVerdict: 'modify' })).schedule).toBe(true);
  });

  it('delayHours = ngày hôm sau', () => {
    expect(decideFollowup(input({ adaptationActive: true })).delayHours).toBe(20);
  });
});

describe('processFollowupReactions', () => {
  it('feelWorse | newPain | lingering -> requiresConservativeAction', () => {
    expect(
      processFollowupReactions({
        feelWorse: true,
        newPainAppeared: false,
        sorenessLingering: false,
        recoveredWell: false,
      }).requiresConservativeAction,
    ).toBe(true);
    expect(
      processFollowupReactions({
        feelWorse: false,
        newPainAppeared: true,
        sorenessLingering: false,
        recoveredWell: false,
      }).requiresConservativeAction,
    ).toBe(true);
  });

  it('recoveredWell alone -> false + delayedSignal đúng', () => {
    const out = processFollowupReactions({
      feelWorse: false,
      newPainAppeared: false,
      sorenessLingering: false,
      recoveredWell: true,
    });
    expect(out.requiresConservativeAction).toBe(false);
    expect(out.delayedSignal).toEqual({
      worseNextDay: false,
      newPain: false,
      lingeringSoreness: false,
    });
  });
});
