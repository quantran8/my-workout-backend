import {
  isoWeekday,
  daysBetween,
  resolveDate,
  totalPlannedSessions,
} from '../calendar';

// Program: bắt đầu Thứ 2 2026-07-20, tập Mon/Wed/Fri (ISO [1,3,5]), 12 tuần.
const program = {
  startDate: '2026-07-20',
  durationWeeks: 12,
  trainingDays: [1, 3, 5],
};

describe('isoWeekday', () => {
  it('maps Sunday to 7, Monday to 1', () => {
    expect(isoWeekday('2026-07-20')).toBe(1); // Mon
    expect(isoWeekday('2026-07-24')).toBe(5); // Fri
    expect(isoWeekday('2026-07-26')).toBe(7); // Sun
  });
});

describe('daysBetween', () => {
  it('counts whole UTC days, signed', () => {
    expect(daysBetween('2026-07-20', '2026-07-27')).toBe(7);
    expect(daysBetween('2026-07-27', '2026-07-20')).toBe(-7);
    expect(daysBetween('2026-07-20', '2026-07-20')).toBe(0);
  });
});

describe('resolveDate', () => {
  it('a start-day training day is week 1, day 1', () => {
    expect(resolveDate('2026-07-20', program)).toEqual({
      status: 'training',
      weekNumber: 1,
      dayNumber: 1,
    });
  });

  it('Wed of week 1 is day 2, Fri is day 3', () => {
    expect(resolveDate('2026-07-22', program)).toEqual({
      status: 'training',
      weekNumber: 1,
      dayNumber: 2,
    });
    expect(resolveDate('2026-07-24', program)).toEqual({
      status: 'training',
      weekNumber: 1,
      dayNumber: 3,
    });
  });

  it('a non-training weekday inside the program is rest', () => {
    // Tue 2026-07-21 — not in [1,3,5]
    expect(resolveDate('2026-07-21', program)).toEqual({ status: 'rest' });
    // Sun 2026-07-26
    expect(resolveDate('2026-07-26', program)).toEqual({ status: 'rest' });
  });

  it('rolls into later weeks by 7-day blocks', () => {
    // Mon 2026-07-27 = 7 days in -> week 2, day 1
    expect(resolveDate('2026-07-27', program)).toEqual({
      status: 'training',
      weekNumber: 2,
      dayNumber: 1,
    });
  });

  it('a date before startDate is before_start', () => {
    expect(resolveDate('2026-07-19', program)).toEqual({ status: 'before_start' });
  });

  it('a date past the last week is program_complete', () => {
    // 12 weeks from Mon 07-20 -> last day is Sun 2026-10-11; week 13 starts Mon 2026-10-12.
    expect(resolveDate('2026-10-12', program)).toEqual({ status: 'program_complete' });
  });

  it('trainingDays empty -> every in-range day is rest', () => {
    const p = { ...program, trainingDays: [] };
    expect(resolveDate('2026-07-20', p)).toEqual({ status: 'rest' });
  });
});

describe('totalPlannedSessions', () => {
  it('is durationWeeks × training-days-per-week', () => {
    expect(totalPlannedSessions(program)).toBe(36); // 12 × 3
    expect(totalPlannedSessions({ durationWeeks: 4, trainingDays: [1, 4] })).toBe(8);
  });
});
