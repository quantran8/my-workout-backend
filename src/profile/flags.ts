// profile/flags.ts
// DETERMINISTIC. Không LLM. Port từ profile_flags.py, giữ nguyên logic đã test.
// Pure functions -> dễ unit test, NestJS provider chỉ cần bọc quanh.

import { Profile, RedFlag, Action, ActionCode } from './profile.types';

export function computeBmi(weightKg?: number | null, heightCm?: number | null): number | null {
  if (!weightKg || !heightCm) return null;
  const h = heightCm / 100;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}

/**
 * Đọc constraint + target -> red flags.
 * Flags là POLICY (hành động), KHÔNG phải con số dinh dưỡng.
 * An toàn luôn nghiêng về medical referral + khởi động thận trọng.
 * Lưu ý: hàm này KHÔNG mutate profile; BMI được trả trong flag payload nếu cần.
 */
export function computeFlags(profile: Profile): { flags: RedFlag[]; bmi: number | null } {
  const c = profile.constraint;
  const t = profile.target;
  const flags: RedFlag[] = [];

  const add = (
    code: string,
    severity: RedFlag['severity'],
    actions: ActionCode[],
    payload: Record<string, unknown> = {},
    message: string | null = null,
  ) => flags.push({ code, severity, actions, payload, message });

  // ---------- BMI (ngưỡng WHO) ----------
  const bmi = computeBmi(c.weightKg, c.heightCm);
  if (bmi !== null) {
    if (bmi < 16) {
      add('BMI_SEVERE_LOW', 'high',
        [Action.MEDICAL_REFERRAL, Action.NO_CALORIE_DEFICIT, Action.CONSERVATIVE_START],
        { bmi },
        'Chỉ số khối cơ thể rất thấp — nên gặp bác sĩ để loại trừ nguyên nhân bệnh lý trước khi bắt đầu.');
    } else if (bmi < 18.5) {
      add('BMI_LOW', 'medium',
        [Action.MEDICAL_REFERRAL, Action.NO_CALORIE_DEFICIT],
        { bmi },
        'Bạn đang thiếu cân. Chương trình sẽ ưu tiên tăng khối lượng cơ và không tạo thâm hụt calo. Cân nhắc kiểm tra y tế nếu bạn khó tăng cân dù ăn đủ.');
    } else if (bmi >= 40) {
      add('BMI_VERY_HIGH', 'high',
        [Action.MEDICAL_REFERRAL, Action.CONSERVATIVE_START],
        { bmi },
        'Nên tham khảo bác sĩ trước khi bắt đầu chương trình cường độ cao.');
    } else if (bmi >= 30) {
      add('BMI_HIGH', 'low',
        [Action.CONSERVATIVE_START],
        { bmi },
        'Chương trình sẽ ưu tiên bài ít tải khớp ở giai đoạn đầu.');
    }
  }

  // ---------- Tuổi ----------
  if (c.age != null) {
    if (c.age < 18) {
      add('MINOR', 'high',
        [Action.REQUIRE_GUARDIAN, Action.CONSERVATIVE_START],
        { age: c.age },
        'Người dùng dưới 18 tuổi — cần sự đồng hành của phụ huynh/người giám hộ và tránh chương trình cường độ cao.');
    } else if (c.age >= 60) {
      add('OLDER_ADULT', 'medium',
        [Action.MEDICAL_REFERRAL, Action.CONSERVATIVE_START],
        { age: c.age },
        'Nên tham khảo bác sĩ trước khi tăng cường độ; chương trình khởi động thận trọng.');
    }
  }

  // ---------- Kinh nghiệm ----------
  if (c.experienceLevel === 'beginner') {
    add('BEGINNER_VOLUME_CAP', 'low',
      [Action.VOLUME_CAP, Action.CONSERVATIVE_START],
      { maxWeeklySetsPerMuscle: 10 });
  }

  // ---------- Chấn thương active ----------
  for (const inj of c.injuries ?? []) {
    if (inj.active !== false) {
      add('INJURY_ACTIVE', 'high',
        [Action.BLOCK_EXERCISE_AREA],
        { area: inj.area, severity: inj.severity },
        `Sẽ loại các bài gây áp lực lên vùng ${inj.area} cho tới khi hồi phục.`);
    }
  }

  // ---------- Xung đột mục tiêu (target × constraint) ----------
  const needs = new Set((t.inferredNeeds ?? []).map((n) => n.type));
  const lowBmi = bmi !== null && bmi < 18.5;
  const wantsGain =
    needs.has('weight_gain') ||
    (lowBmi && (needs.has('hypertrophy') || needs.has('strength')));
  const wantsEndurance = needs.has('endurance');
  if (lowBmi && wantsEndurance && (wantsGain || needs.has('hypertrophy') || needs.has('strength'))) {
    add('GOAL_CONFLICT_GAIN_VS_ENDURANCE', 'medium',
      [Action.RESOLVE_GOAL_CONFLICT, Action.NO_CALORIE_DEFICIT, Action.NO_AGGRESSIVE_SURPLUS],
      {
        conflict: 'cardio nhiều đốt calo thặng dư cần cho tăng cân/cơ',
        suggestedPriority: ['strength_hypertrophy_phase1', 'endurance_phase2'],
      },
      'Mục tiêu tăng thể lực và tăng cân/cơ hơi ngược nhau ở thể trạng hiện tại. Chương trình sẽ ưu tiên sức mạnh + khối cơ trước, giữ cardio ở mức tối thiểu, rồi nâng dần sức bền sau.');
  }

  return { flags, bmi };
}
