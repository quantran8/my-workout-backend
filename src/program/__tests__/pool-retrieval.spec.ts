import { slimPool, buildSlots } from '../pool-retrieval';
import { Exercise } from '../../profile/guardrail';

// Fixture: camelCase Exercise rows (shape guardrail/validator use), with extra fields
// (cues/media) that slimPool must drop.
const pool: Exercise[] = [
  {
    exerciseId: 'goblet_squat',
    name: 'Goblet Squat',
    exerciseType: 'resistance',
    equipment: ['dumbbell'],
    difficulty: 2,
    contraindications: [],
    primaryMuscles: ['quads', 'glutes'],
    movementPattern: 'squat',
    goalFit: ['strength', 'hypertrophy'],
    defaultRx: { sets: 3, rep_range: [8, 12], rest_sec: 90 },
    cues: ['keep chest up'],
    media: { start_img: 'x', end_img: 'y' },
    secondaryMuscles: ['hamstrings'],
    aliases: [],
    source: { repo: 'x' },
  } as unknown as Exercise,
  {
    exerciseId: 'romanian_deadlift',
    name: 'Romanian Deadlift',
    exerciseType: 'resistance',
    equipment: ['dumbbell'],
    difficulty: 3,
    contraindications: [{ injuryArea: 'lower_back' }],
    primaryMuscles: ['hamstrings', 'glutes'],
    movementPattern: 'hinge',
    goalFit: ['strength'],
    defaultRx: { sets: 3, rep_range: [6, 10], rest_sec: 120 },
  } as unknown as Exercise,
  {
    exerciseId: 'pushup',
    name: 'Push-up',
    exerciseType: 'resistance',
    equipment: ['bodyweight'],
    difficulty: 2,
    contraindications: [],
    primaryMuscles: ['chest', 'triceps'],
    movementPattern: 'push_h',
    goalFit: ['hypertrophy', 'endurance'],
  } as unknown as Exercise,
];

describe('slimPool', () => {
  it('keeps exactly the 9 whitelisted fields (snake_case) and drops cues/media/source', () => {
    const slim = slimPool(pool);
    expect(Object.keys(slim[0]).sort()).toEqual(
      [
        'default_prescription',
        'difficulty',
        'equipment',
        'exercise_id',
        'exercise_type',
        'goal_fit',
        'movement_pattern',
        'name',
        'primary_muscles',
      ].sort(),
    );
    // dropped fields
    expect(slim[0]).not.toHaveProperty('cues');
    expect(slim[0]).not.toHaveProperty('media');
    expect(slim[0]).not.toHaveProperty('secondaryMuscles');
    expect(slim[0]).not.toHaveProperty('contraindications');
  });

  it('maps camelCase -> snake_case correctly', () => {
    const slim = slimPool(pool);
    expect(slim[0].exercise_id).toBe('goblet_squat');
    expect(slim[0].movement_pattern).toBe('squat');
    expect(slim[0].primary_muscles).toEqual(['quads', 'glutes']);
    expect(slim[0].default_prescription).toEqual({
      sets: 3,
      rep_range: [8, 12],
      rest_sec: 90,
    });
  });
});

describe('buildSlots', () => {
  it('never emits an exercise outside the input pool', () => {
    const selected = buildSlots(pool, ['strength'], {
      daysPerWeek: 3,
      minutesPerSession: 45,
    });
    const poolIds = new Set(pool.map((e) => e.exerciseId));
    for (const e of selected) expect(poolIds.has(e.exerciseId)).toBe(true);
  });

  it('respects the slot cap derived from minutesPerSession', () => {
    // 24 min / 8 = 3 slots
    const selected = buildSlots(pool, ['strength'], {
      daysPerWeek: 3,
      minutesPerSession: 24,
    });
    expect(selected.length).toBeLessThanOrEqual(3);
    expect(selected.length).toBeGreaterThan(0);
  });

  it('prefers goal-matching exercises when covering patterns', () => {
    const selected = buildSlots(pool, ['endurance'], {
      daysPerWeek: 3,
      minutesPerSession: 45,
    });
    // pushup is the only endurance-fit exercise; it should be selected
    expect(selected.map((e) => e.exerciseId)).toContain('pushup');
  });

  it('returns empty for an empty pool', () => {
    expect(buildSlots([], ['strength'], { daysPerWeek: 3 })).toEqual([]);
  });
});
