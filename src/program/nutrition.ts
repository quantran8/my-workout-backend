// program/nutrition.ts
// DETERMINISTIC. Không LLM. Tính mục tiêu calo/đạm từ profile.constraint (Mifflin–St Jeor).
// Client CHỈ hiển thị — API-3 (mobile): giá trị dinh dưỡng an toàn phải do server tính, không
// để client tự suy ra. Ngưỡng là literal ở đầu file; bump `ruleVersion` khi đổi.

import type { Profile } from '../profile/profile.types';

export const NUTRITION_RULE_VERSION = 'nutrition/v1.0';

// Hệ số hoạt động "lightly active" — khớp mock cũ của client (1.45) để plan không nhảy số
// khi swap seam. Surplus khi thiếu cân, giữ maintenance ở các trường hợp còn lại.
const ACTIVITY_FACTOR = 1.45;
const UNDERWEIGHT_SURPLUS_KCAL = 350;
const UNDERWEIGHT_BMI = 18.5;

// Đạm theo cân nặng: 1.6–2.0 g/kg (khoảng khuyến nghị cho người tập kháng lực).
const PROTEIN_LOW_PER_KG = 1.6;
const PROTEIN_HIGH_PER_KG = 2.0;

export interface NutritionTarget {
  calorieLow: number;
  calorieHigh: number;
  proteinLow: number;
  proteinHigh: number;
  /** 'surplus' khi thiếu cân, 'maintain' còn lại — client map sang câu mô tả đã bản địa hoá. */
  intent: 'surplus' | 'maintain';
}

/** Làm tròn về bội số 50 để đọc như một mục tiêu, không phải kết quả công thức. */
function round50(v: number): number {
  return Math.round(v / 50) * 50;
}

/**
 * Trả null khi thiếu dữ liệu cơ thể (sex/age/height/weight) — chưa đủ để tính an toàn,
 * client ẩn thẻ dinh dưỡng thay vì hiển thị số bịa.
 */
export function computeNutrition(profile: Profile): NutritionTarget | null {
  const c = profile.constraint;
  const { sex, age, heightCm, weightKg } = c;
  if (sex == null || age == null || heightCm == null || weightKg == null) {
    return null;
  }

  // Mifflin–St Jeor. 'other' dùng nhánh nam (hằng số +5) như một mặc định trung tính.
  const bmr =
    sex === 'female'
      ? 10 * weightKg + 6.25 * heightCm - 5 * age - 161
      : 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  const maintenance = bmr * ACTIVITY_FACTOR;

  const bmi = c.bmi ?? weightKg / (heightCm / 100) ** 2;
  const underweight = bmi < UNDERWEIGHT_BMI;
  const target = underweight ? maintenance + UNDERWEIGHT_SURPLUS_KCAL : maintenance;

  return {
    calorieLow: round50(target - 50),
    calorieHigh: round50(target + 50),
    proteinLow: Math.round(weightKg * PROTEIN_LOW_PER_KG),
    proteinHigh: Math.round(weightKg * PROTEIN_HIGH_PER_KG),
    intent: underweight ? 'surplus' : 'maintain',
  };
}
