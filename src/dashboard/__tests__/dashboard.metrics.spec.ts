import {
  computeAdherence,
  computeStreak,
  computeVolumeKg,
  toDateString,
} from '../dashboard.metrics';

// A fixed "now" so streak day-math is deterministic. 2026-07-24, midday UTC.
const NOW = new Date('2026-07-24T12:00:00.000Z');
const day = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

describe('computeStreak', () => {
  it('is 0 with no completed sessions', () => {
    expect(computeStreak([], NOW)).toBe(0);
  });

  it('counts consecutive days ending today', () => {
    const sessions = [day('2026-07-24'), day('2026-07-23'), day('2026-07-22')];
    expect(computeStreak(sessions, NOW)).toBe(3);
  });

  it('stays alive through yesterday when today has no session', () => {
    const sessions = [day('2026-07-23'), day('2026-07-22')];
    expect(computeStreak(sessions, NOW)).toBe(2);
  });

  it('is 0 once the streak has lapsed (nothing today or yesterday)', () => {
    const sessions = [day('2026-07-21'), day('2026-07-20')];
    expect(computeStreak(sessions, NOW)).toBe(0);
  });

  it('breaks at the first gap', () => {
    // today, yesterday, then a gap on the 22nd — earlier days do not count.
    const sessions = [day('2026-07-24'), day('2026-07-23'), day('2026-07-21')];
    expect(computeStreak(sessions, NOW)).toBe(2);
  });

  it('collapses multiple sessions on the same day into one', () => {
    const sessions = [
      new Date('2026-07-24T07:00:00.000Z'),
      new Date('2026-07-24T19:00:00.000Z'),
      day('2026-07-23'),
    ];
    expect(computeStreak(sessions, NOW)).toBe(2);
  });
});

describe('computeAdherence', () => {
  it('is 1 for an empty window (nothing due yet)', () => {
    expect(computeAdherence(0, 0)).toBe(1);
  });

  it('is the ratio of done to due', () => {
    expect(computeAdherence(4, 5)).toBeCloseTo(0.8);
  });

  it('clamps above 1 (more logged than scheduled)', () => {
    expect(computeAdherence(6, 5)).toBe(1);
  });

  it('is 0 when nothing done', () => {
    expect(computeAdherence(0, 5)).toBe(0);
  });
});

describe('computeVolumeKg', () => {
  it('sums weight × reps and rounds to whole kg', () => {
    const sets = [
      { actualWeightKg: 60, actualReps: 5 }, // 300
      { actualWeightKg: 62.5, actualReps: 3 }, // 187.5
    ];
    expect(computeVolumeKg(sets)).toBe(488); // 487.5 → 488
  });

  it('treats missing weight or reps as 0 volume (bodyweight/duration sets)', () => {
    const sets = [
      { actualWeightKg: null, actualReps: 12 },
      { actualWeightKg: 40, actualReps: null },
      { actualWeightKg: 20, actualReps: 10 }, // 200
    ];
    expect(computeVolumeKg(sets)).toBe(200);
  });

  it('is 0 for no sets', () => {
    expect(computeVolumeKg([])).toBe(0);
  });
});

describe('toDateString', () => {
  it('is day-granular UTC YYYY-MM-DD', () => {
    expect(toDateString(new Date('2026-07-24T23:30:00.000Z'))).toBe('2026-07-24');
  });
});
