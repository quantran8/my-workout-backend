import { computeNutrition } from '../nutrition';
import type { Profile } from '../../profile/profile.types';

function profile(over: Partial<Profile['constraint']> = {}): Profile {
  return {
    constraint: {
      sex: 'male',
      age: 30,
      heightCm: 175,
      weightKg: 70,
      injuries: [],
      mobilityLimits: [],
      equipment: [],
      ...over,
    },
    target: { statedGoals: [], problems: [], inferredNeeds: [] },
  };
}

describe('computeNutrition', () => {
  it('returns null when body data is incomplete', () => {
    expect(computeNutrition(profile({ weightKg: null }))).toBeNull();
    expect(computeNutrition(profile({ sex: null }))).toBeNull();
  });

  it('maintains at a healthy BMI', () => {
    const n = computeNutrition(profile())!;
    expect(n.intent).toBe('maintain');
    // Calories rounded to 50; protein 1.6–2.0 g/kg of 70kg.
    expect(n.calorieLow % 50).toBe(0);
    expect(n.proteinLow).toBe(112);
    expect(n.proteinHigh).toBe(140);
  });

  it('adds a surplus when underweight', () => {
    // 45kg at 165cm -> BMI ~16.5.
    const lean = computeNutrition(profile({ weightKg: 45, heightCm: 165, sex: 'female' }))!;
    const healthy = computeNutrition(profile({ weightKg: 58, heightCm: 165, sex: 'female' }))!;
    expect(lean.intent).toBe('surplus');
    expect(healthy.intent).toBe('maintain');
    // The surplus lifts the target above the equivalent maintenance line.
    expect(lean.calorieHigh).toBeGreaterThan(healthy.calorieHigh - 300);
  });
});
