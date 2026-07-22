// profile/__tests__/guardrail.spec.ts
import { computeFlags, computeBmi } from '../flags';
import { buildGuardrail, Exercise } from '../guardrail';
import { Profile, Action } from '../profile.types';

const case49kg: Profile = {
  constraint: {
    sex: 'male', age: 26, heightCm: 170, weightKg: 49,
    experienceLevel: 'beginner',
    equipment: ['dumbbell', 'bodyweight'],
    injuries: [], mobilityLimits: [],
    diet: { type: 'vegetarian', allergies: [], restrictions: [] },
  },
  target: {
    statedGoals: ['cải thiện thể lực'],
    problems: ['tụt thể lực', 'không tì đè được'],
    inferredNeeds: [
      { type: 'strength' }, { type: 'hypertrophy' }, { type: 'endurance' },
    ],
  },
};

describe('flags engine (ca 49kg)', () => {
  it('tính BMI = 17.0', () => {
    expect(computeBmi(49, 170)).toBe(17);
  });
  it('bắt BMI_LOW + GOAL_CONFLICT + cấm thâm hụt calo', () => {
    const { flags } = computeFlags(case49kg);
    const codes = flags.map((f) => f.code);
    const actions = new Set(flags.flatMap((f) => f.actions));
    expect(codes).toContain('BMI_LOW');
    expect(codes).toContain('GOAL_CONFLICT_GAIN_VS_ENDURANCE');
    expect(actions.has(Action.NO_CALORIE_DEFICIT)).toBe(true);
  });
});

describe('guardrail lọc pool theo chấn thương', () => {
  const lib: Exercise[] = [
    { exerciseId: 'ohp', slug: 'ohp', name: 'Overhead Press', exerciseType: 'resistance',
      equipment: ['dumbbell'], difficulty: 3,
      contraindications: [{ injuryArea: 'shoulder' }] },
    { exerciseId: 'goblet', slug: 'goblet', name: 'Goblet Squat', exerciseType: 'resistance',
      equipment: ['dumbbell'], difficulty: 2,
      contraindications: [{ injuryArea: 'knee' }] },
    { exerciseId: 'pushup', slug: 'pushup', name: 'Push-up', exerciseType: 'resistance',
      equipment: ['bodyweight'], difficulty: 2, contraindications: [] },
  ];
  const shoulderCase: Profile = {
    ...case49kg,
    constraint: {
      ...case49kg.constraint, weightKg: 58, heightCm: 162, sex: 'female',
      injuries: [{ area: 'shoulder', severity: 'moderate', active: true }],
    },
  };

  it('loại đúng bài đụng vai, giữ bài an toàn', () => {
    const g = buildGuardrail(shoulderCase, lib);
    const allowedIds = g.allowedPool.map((e) => e.exerciseId);
    expect(allowedIds).not.toContain('ohp');   // vai -> loại
    expect(allowedIds).toContain('pushup');    // an toàn -> giữ
    expect(g.policy.blockedInjuryAreas).toContain('shoulder');
  });
});

describe('guardrail — adaptation phase caps (§2)', () => {
  const healthy: Profile = {
    ...case49kg,
    constraint: {
      ...case49kg.constraint,
      weightKg: 70, heightCm: 175, experienceLevel: 'intermediate',
      injuries: [],
    },
    target: { statedGoals: [], problems: [], inferredNeeds: [{ type: 'strength' }] },
  };
  const lib: Exercise[] = [
    { exerciseId: 'easy', slug: 'easy', name: 'Easy', exerciseType: 'resistance',
      equipment: ['dumbbell'], difficulty: 2, contraindications: [], impactLevel: 'low' },
    { exerciseId: 'hard', slug: 'hard', name: 'Hard', exerciseType: 'resistance',
      equipment: ['dumbbell'], difficulty: 4, contraindications: [], impactLevel: 'low' },
    { exerciseId: 'jump', slug: 'jump', name: 'Box Jump', exerciseType: 'resistance',
      equipment: ['bodyweight'], difficulty: 2, contraindications: [], impactLevel: 'high' },
  ];

  it('không caps (2-arg) -> giữ nguyên hành vi cũ', () => {
    const g = buildGuardrail(healthy, lib);
    const ids = g.allowedPool.map((e) => e.exerciseId);
    // intermediate, không conservative -> maxDiff 5, không lọc impact
    expect(ids).toEqual(['easy', 'hard', 'jump']);
  });

  it('difficultyCap 2 -> loại bài difficulty 4', () => {
    const g = buildGuardrail(healthy, lib, {
      volumeCapPct: 60, difficultyCap: 2, impactCap: 'high',
    });
    const ids = g.allowedPool.map((e) => e.exerciseId);
    expect(ids).not.toContain('hard');
    expect(ids).toContain('easy');
    expect(g.policy.adaptationDifficultyCap).toBe(2);
  });

  it('impactCap low -> loại bài high-impact', () => {
    const g = buildGuardrail(healthy, lib, {
      volumeCapPct: 60, difficultyCap: 5, impactCap: 'low',
    });
    const ids = g.allowedPool.map((e) => e.exerciseId);
    expect(ids).not.toContain('jump'); // high impact -> loại
    expect(ids).toContain('easy');
  });
});
