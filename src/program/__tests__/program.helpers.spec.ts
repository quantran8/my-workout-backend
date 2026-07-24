import { trainingDaysFromProfile } from '../program.helpers';
import type { Profile } from '../../profile/profile.types';

function profileWith(schedule: Profile['constraint']['schedule']): Profile {
  return {
    constraint: {
      sex: 'male',
      age: 30,
      heightCm: 175,
      weightKg: 75,
      experienceLevel: 'beginner',
      equipment: ['bodyweight'],
      injuries: [],
      mobilityLimits: [],
      schedule,
    } as Profile['constraint'],
    target: { statedGoals: [], problems: [], inferredNeeds: [] },
  };
}

describe('trainingDaysFromProfile', () => {
  it('honours preferredDays, normalised to ISO weekdays, sorted', () => {
    const p = profileWith({ daysPerWeek: 3, preferredDays: ['Fri', 'mon', 'wed'] });
    expect(trainingDaysFromProfile(p)).toEqual([1, 3, 5]);
  });

  it('maps Vietnamese day labels', () => {
    const p = profileWith({ daysPerWeek: 2, preferredDays: ['thứ 3', 'thứ 5'] });
    expect(trainingDaysFromProfile(p)).toEqual([2, 4]);
  });

  it('fills from the default spread when preferredDays is missing', () => {
    const p = profileWith({ daysPerWeek: 3 });
    expect(trainingDaysFromProfile(p)).toEqual([1, 3, 5]); // Mon/Wed/Fri
  });

  it('tops up when preferredDays has fewer than daysPerWeek', () => {
    const p = profileWith({ daysPerWeek: 3, preferredDays: ['mon'] });
    const days = trainingDaysFromProfile(p);
    expect(days).toContain(1);
    expect(days).toHaveLength(3);
    expect([...days].sort((a, b) => a - b)).toEqual(days); // sorted
  });

  it('never exceeds daysPerWeek even with more preferredDays', () => {
    const p = profileWith({
      daysPerWeek: 2,
      preferredDays: ['mon', 'tue', 'wed', 'thu'],
    });
    expect(trainingDaysFromProfile(p)).toHaveLength(2);
  });

  it('returns empty when daysPerWeek is unset', () => {
    const p = profileWith({});
    expect(trainingDaysFromProfile(p)).toEqual([]);
  });
});
