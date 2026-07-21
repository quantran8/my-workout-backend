import { buildExecutionSnapshot, PlannedInput, EffectiveRx } from '../execution-snapshot';
import { ReadinessResult, ReadinessMod, PlannedItem } from '../readiness';

const rx = (sets: number): EffectiveRx => ({ targetSets: sets, targetReps: [8, 12], restSec: 90 });

const item = (id: string, pattern: string, areas: string[]): PlannedItem => ({
  prescriptionId: `p-${id}`,
  exerciseId: id,
  movementPattern: pattern,
  bodyAreas: areas,
});

const planned: PlannedInput[] = [
  { item: item('goblet_squat', 'squat', ['knee']), order: 1, rx: rx(5) },
  { item: item('ohp', 'push_v', ['shoulder']), order: 2, rx: rx(4) },
];

const result = (mods: ReadinessResult['modifications']): ReadinessResult => ({
  verdict: 'modify',
  modifications: mods,
  ruleVersion: 'readiness/v4.0',
});

const noRegression = () => null;
const noSubstitute = () => null;

describe('buildExecutionSnapshot', () => {
  it('không modification -> effectiveRx == plannedRx, status planned', () => {
    const snap = buildExecutionSnapshot(planned, result([]), noRegression, noSubstitute);
    expect(snap.items[0].effectiveRx).toEqual(snap.items[0].plannedRx);
    expect(snap.items.every((i) => i.status === 'planned')).toBe(true);
  });

  it('REDUCE_VOLUME 60% trên 5 set -> 3 set', () => {
    const snap = buildExecutionSnapshot(
      planned,
      result([
        {
          code: ReadinessMod.REDUCE_VOLUME,
          scope: 'session',
          reason: 'x',
          payload: { volumeCapPct: 60 },
        },
      ]),
      noRegression,
      noSubstitute,
    );
    expect(snap.items[0].effectiveRx.targetSets).toBe(3); // round(5*0.6)=3
    expect(snap.items[0].appliedModifications).toContain(ReadinessMod.REDUCE_VOLUME);
  });

  it('HOLD_SESSION -> mọi item status=held', () => {
    const snap = buildExecutionSnapshot(
      planned,
      { verdict: 'hold', modifications: [{ code: ReadinessMod.HOLD_SESSION, scope: 'session', reason: 'x' }], ruleVersion: 'readiness/v4.0' },
      noRegression,
      noSubstitute,
    );
    expect(snap.items.every((i) => i.status === 'held')).toBe(true);
  });

  it('HOLD_MOVEMENT_PATTERN chỉ held đúng pattern', () => {
    const snap = buildExecutionSnapshot(
      planned,
      result([
        { code: ReadinessMod.HOLD_MOVEMENT_PATTERN, scope: 'movement_pattern', target: 'push_v', reason: 'x' },
      ]),
      noRegression,
      noSubstitute,
    );
    const byId = new Map(snap.items.map((i) => [i.exerciseId, i]));
    expect(byId.get('ohp')!.status).toBe('held');
    expect(byId.get('goblet_squat')!.status).toBe('planned');
  });

  it('USE_REGRESSION swap exerciseId qua resolver; null -> giữ nguyên id', () => {
    const withResolver = buildExecutionSnapshot(
      planned,
      result([
        { code: ReadinessMod.USE_REGRESSION, scope: 'exercise', target: 'goblet_squat', reason: 'x' },
      ]),
      (id) => (id === 'goblet_squat' ? 'box_squat' : null),
      noSubstitute,
    );
    expect(withResolver.items[0].exerciseId).toBe('box_squat');
    expect(withResolver.items[0].originalExerciseId).toBe('goblet_squat');

    const noResolver = buildExecutionSnapshot(
      planned,
      result([
        { code: ReadinessMod.USE_REGRESSION, scope: 'exercise', target: 'goblet_squat', reason: 'x' },
      ]),
      noRegression,
      noSubstitute,
    );
    expect(noResolver.items[0].exerciseId).toBe('goblet_squat');
  });

  it('SUBSTITUTE_EXERCISE dùng resolver; không có bài thay -> skip khi cũng không regression', () => {
    const snap = buildExecutionSnapshot(
      planned,
      result([
        { code: ReadinessMod.SUBSTITUTE_EXERCISE, scope: 'exercise', target: 'ohp', reason: 'x' },
      ]),
      noRegression,
      noSubstitute,
    );
    const ohp = snap.items.find((i) => i.originalExerciseId === 'ohp')!;
    expect(ohp.status).toBe('skipped');
  });

  it('deterministic: cùng input -> deep-equal output', () => {
    const a = buildExecutionSnapshot(planned, result([]), noRegression, noSubstitute);
    const b = buildExecutionSnapshot(planned, result([]), noRegression, noSubstitute);
    expect(a).toEqual(b);
  });
});
