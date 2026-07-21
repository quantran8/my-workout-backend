import {
  detectAdaptationTriggers,
  stepAdaptationPhase,
  AdaptationTrigger,
  AdaptationState,
} from '../adaptation-phase';
import { Profile } from '../profile.types';

const profile = (over: Partial<Profile['constraint']> = {}): Profile => ({
  constraint: {
    experienceLevel: 'intermediate',
    injuries: [],
    mobilityLimits: [],
    equipment: ['dumbbell'],
    ...over,
  },
  target: { statedGoals: [], problems: [], inferredNeeds: [] },
});

const known = { hadBadReaction: false, toleranceKnown: true };

describe('detectAdaptationTriggers', () => {
  it('beginner', () => {
    const t = detectAdaptationTriggers(profile({ experienceLevel: 'beginner' }), known);
    expect(t).toContain(AdaptationTrigger.BEGINNER);
  });

  it('recentActivityLevel very_low', () => {
    const t = detectAdaptationTriggers(profile({ recentActivityLevel: 'very_low' }), known);
    expect(t).toContain(AdaptationTrigger.RECENT_ACTIVITY_VERY_LOW);
  });

  it('long detraining >= 12 tuần', () => {
    const t = detectAdaptationTriggers(profile({ detrainingDurationWeeks: 12 }), known);
    expect(t).toContain(AdaptationTrigger.LONG_DETRAINING);
    const t2 = detectAdaptationTriggers(profile({ detrainingDurationWeeks: 8 }), known);
    expect(t2).not.toContain(AdaptationTrigger.LONG_DETRAINING);
  });

  it('unknown tolerance', () => {
    const t = detectAdaptationTriggers(profile(), { hadBadReaction: false, toleranceKnown: false });
    expect(t).toContain(AdaptationTrigger.UNKNOWN_TOLERANCE);
  });

  it('returning after bad reaction', () => {
    const t = detectAdaptationTriggers(profile(), { hadBadReaction: true, toleranceKnown: true });
    expect(t).toContain(AdaptationTrigger.RETURNING_AFTER_BAD_REACTION);
  });

  it('intermediate không trigger nào', () => {
    expect(detectAdaptationTriggers(profile(), known)).toHaveLength(0);
  });
});

describe('stepAdaptationPhase', () => {
  it('none + triggers -> active với caps standard', () => {
    const s = stepAdaptationPhase(null, [AdaptationTrigger.BEGINNER], 0);
    expect(s.status).toBe('active');
    expect(s.caps).toEqual({ volumeCapPct: 60, difficultyCap: 3, impactCap: 'low' });
  });

  it('long detraining / bad reaction -> caps STRICT', () => {
    const s = stepAdaptationPhase(null, [AdaptationTrigger.LONG_DETRAINING], 0);
    expect(s.caps).toEqual({ volumeCapPct: 50, difficultyCap: 2, impactCap: 'low' });
  });

  it('không trigger -> none, caps null', () => {
    const s = stepAdaptationPhase(null, [], 0);
    expect(s.status).toBe('none');
    expect(s.caps).toBeNull();
  });

  it('active -> exited khi consecutiveTolerated >= 3', () => {
    const active: AdaptationState = {
      status: 'active',
      triggers: [AdaptationTrigger.BEGINNER],
      caps: { volumeCapPct: 60, difficultyCap: 3, impactCap: 'low' },
      consecutiveToleratedSessions: 2,
      ruleVersion: 'adaptation/v4.0',
    };
    expect(stepAdaptationPhase(active, [AdaptationTrigger.BEGINNER], 2).status).toBe('active');
    const exited = stepAdaptationPhase(active, [AdaptationTrigger.BEGINNER], 3);
    expect(exited.status).toBe('exited');
    expect(exited.caps).toBeNull();
  });

  it('re-entry: bad reaction mới -> active lại (reset consecutive)', () => {
    const exited: AdaptationState = {
      status: 'exited',
      triggers: [],
      caps: null,
      consecutiveToleratedSessions: 5,
      ruleVersion: 'adaptation/v4.0',
    };
    const s = stepAdaptationPhase(exited, [AdaptationTrigger.RETURNING_AFTER_BAD_REACTION], 5);
    expect(s.status).toBe('active');
    expect(s.consecutiveToleratedSessions).toBe(0);
  });
});
