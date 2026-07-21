import { computeSessionFeedback } from '../session-feedback';
import type { WorkoutSession, LoggedSet } from '../session.types';

type ExType = 'resistance' | 'cardio' | 'mobility';

function session(sets: Partial<LoggedSet>[]): WorkoutSession {
  return {
    sessionId: 's1',
    userId: 'u1',
    programRevisionId: 'r1',
    environment: 'unknown',
    distanceSource: 'none',
    dataSource: 'manual',
    startedAt: new Date().toISOString(),
    sets: sets.map((s, i) => ({
      setId: `set-${i}`,
      sessionId: 's1',
      exerciseId: s.exerciseId ?? 'squat',
      setNumber: i + 1,
      ...s,
    })) as LoggedSet[],
  };
}

const exTypeOf = (): ExType => 'resistance';

describe('computeSessionFeedback', () => {
  it('first log of an exercise -> baseline (không bịa so sánh)', () => {
    const current = session([
      { exerciseId: 'squat', actualReps: 10, actualWeightKg: 20 },
    ]);
    const fb = computeSessionFeedback(current, exTypeOf, new Map(), 3);
    expect(fb.perExercise[0].status).toBe('baseline');
    expect(fb.summary).toMatch(/buổi đầu tiên/i);
  });

  it('resistance heavier than last time -> better', () => {
    const prior = new Map<string, LoggedSet[]>([
      ['squat', session([{ exerciseId: 'squat', actualReps: 10, actualWeightKg: 20 }]).sets],
    ]);
    const current = session([
      { exerciseId: 'squat', actualReps: 10, actualWeightKg: 25 },
    ]);
    const fb = computeSessionFeedback(current, exTypeOf, prior, 3);
    expect(fb.perExercise[0].status).toBe('better');
  });

  it('same as last time -> same; lower -> lower', () => {
    const prior = new Map<string, LoggedSet[]>([
      ['squat', session([{ exerciseId: 'squat', actualReps: 10, actualWeightKg: 20 }]).sets],
    ]);
    const same = computeSessionFeedback(
      session([{ exerciseId: 'squat', actualReps: 10, actualWeightKg: 20 }]),
      exTypeOf,
      prior,
      3,
    );
    expect(same.perExercise[0].status).toBe('same');

    const lower = computeSessionFeedback(
      session([{ exerciseId: 'squat', actualReps: 8, actualWeightKg: 15 }]),
      exTypeOf,
      prior,
      3,
    );
    expect(lower.perExercise[0].status).toBe('lower');
  });

  it('computes completionPct from prescribed set count', () => {
    const current = session([
      { exerciseId: 'squat', actualReps: 10, actualWeightKg: 20 },
      { exerciseId: 'squat', actualReps: 10, actualWeightKg: 20 },
    ]);
    const fb = computeSessionFeedback(current, exTypeOf, new Map(), 4);
    expect(fb.completionPct).toBe(50); // 2 of 4 prescribed
  });
});
