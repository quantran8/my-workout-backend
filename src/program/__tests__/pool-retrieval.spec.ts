import { slimPool, buildSlots, exercisesPerSession } from '../pool-retrieval';
import { Exercise } from '../../profile/guardrail';

// Fixture: camelCase Exercise rows (shape guardrail/validator use), with extra fields
// (cues/media) that slimPool must drop. exerciseId là uuid v7 (khoá DB), slug là key
// người đọc được — slimPool PHẢI gửi slug cho LLM, không phải uuid.
const pool: Exercise[] = [
  {
    exerciseId: '01919f00-0000-7000-8000-000000000001',
    slug: 'goblet_squat',
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
    exerciseId: '01919f00-0000-7000-8000-000000000002',
    slug: 'romanian_deadlift',
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
    exerciseId: '01919f00-0000-7000-8000-000000000003',
    slug: 'pushup',
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

  it('sends a pool wider than one session (perSession × days), capped at pool size', () => {
    // 24 min / 8 = 3 exercises/session; 3 days -> target 9, but the pool only has
    // 3 rows, so it returns all 3 (never more than the pool). The point: the pool
    // is NOT clamped down to a single session's count anymore.
    const selected = buildSlots(pool, ['strength'], {
      daysPerWeek: 3,
      minutesPerSession: 24,
    });
    expect(selected.length).toBe(3); // whole pool, since 3 < perSession*days
    expect(selected.length).toBeGreaterThan(0);
  });

  it('prefers goal-matching exercises when covering patterns', () => {
    const selected = buildSlots(pool, ['endurance'], {
      daysPerWeek: 3,
      minutesPerSession: 45,
    });
    // pushup is the only endurance-fit exercise; it should be selected
    expect(selected.map((e) => e.slug)).toContain('pushup');
  });

  it('returns empty for an empty pool', () => {
    expect(buildSlots([], ['strength'], { daysPerWeek: 3 })).toEqual([]);
  });
});

describe('exercisesPerSession', () => {
  it('is minutes / 8, clamped to [3, 8]', () => {
    expect(exercisesPerSession(24)).toBe(3); // 24/8 = 3
    expect(exercisesPerSession(48)).toBe(6); // 48/8 = 6
    expect(exercisesPerSession(80)).toBe(8); // 80/8 = 10 -> clamp 8
    expect(exercisesPerSession(8)).toBe(3); // 8/8 = 1 -> clamp 3
  });

  it('defaults to 5 when minutesPerSession is missing', () => {
    expect(exercisesPerSession(null)).toBe(5);
    expect(exercisesPerSession(undefined)).toBe(5);
  });
});
