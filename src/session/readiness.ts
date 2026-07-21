// session/readiness.ts
// DETERMINISTIC. Không LLM. §5.1 — thu readiness TRƯỚC buổi -> verdict + modifications.
// Precedence: hold > modify > ready. 'unknown' là nhánh riêng khi user không trả lời.
// LƯU Ý §12.2: verdict=hold chỉ chặn PHẦN bị hold; bài không đụng vùng đau vẫn tập.
// Threshold là literal ở đầu file (như maxDiff bên guardrail) — bump ruleVersion khi đổi.

export type ReadinessVerdict = 'ready' | 'modify' | 'hold' | 'unknown';
export type DiscomfortSeverity = 'mild' | 'moderate' | 'severe';

export interface Discomfort {
  bodyArea: string; // vùng cơ thể (khớp InjuryArea hoặc chuỗi tự do)
  severity: DiscomfortSeverity;
  affectsNormalMovement: boolean;
}

export interface ReadinessResponses {
  discomforts: Discomfort[];
  residualSoreness: 'none' | 'mild' | 'moderate' | 'high' | null;
  energyLevel: 'low' | 'ok' | 'high' | null;
  externalLoads: {
    poorSleep?: boolean;
    highStress?: boolean;
    illness?: boolean;
  } | null;
  answered: boolean; // false -> nhánh 'unknown'
}

// codes hành động (union thay magic string) — cùng phong cách Action bên profile.types
export const ReadinessMod = {
  REDUCE_VOLUME: 'reduce_volume',
  USE_REGRESSION: 'use_regression',
  SUBSTITUTE_EXERCISE: 'substitute_exercise',
  AVOID_BODY_AREA: 'avoid_body_area',
  REMOVE_EXERCISE: 'remove_exercise',
  HOLD_MOVEMENT_PATTERN: 'hold_movement_pattern',
  HOLD_SESSION: 'hold_session',
} as const;
export type ReadinessModCode = (typeof ReadinessMod)[keyof typeof ReadinessMod];

export interface ReadinessModification {
  code: ReadinessModCode;
  scope: 'session' | 'movement_pattern' | 'exercise' | 'body_area';
  target?: string; // patternId | exerciseId | bodyArea
  reason: string; // câu template tiếng Việt
  payload?: Record<string, unknown>; // vd { volumeCapPct: 60 }
}

// shape tối thiểu của một item đã kê mà engine đọc (inject, không Prisma)
export interface PlannedItem {
  prescriptionId: string;
  exerciseId: string;
  movementPattern: string;
  bodyAreas: string[];
}

export interface ReadinessResult {
  verdict: ReadinessVerdict;
  modifications: ReadinessModification[];
  ruleVersion: string;
}

const RULE_VERSION = 'readiness/v4.0';
const UNKNOWN_CAP_PCT = 70; // trả lời thiếu -> giảm tải thận trọng
const LOW_ENERGY_CAP_PCT = 60; // năng lượng thấp / đau nhức cao
const MODERATE_CAP_PCT = 80; // đau nhức vừa / 1 tải ngoài

function countExternalLoads(e: ReadinessResponses['externalLoads']): number {
  if (!e) return 0;
  return [e.poorSleep, e.highStress, e.illness].filter(Boolean).length;
}

/** áp cho các item mà bodyAreas giao với vùng đau */
function itemsTouching(planned: PlannedItem[], area: string): PlannedItem[] {
  return planned.filter((p) => p.bodyAreas.includes(area));
}

/**
 * @param responses  câu trả lời readiness của user
 * @param planned    các item đã kê của buổi (để scope hold/modify chính xác)
 */
export function assessReadiness(
  responses: ReadinessResponses,
  planned: PlannedItem[],
): ReadinessResult {
  // ---------- (0) UNKNOWN: user không trả lời -> conservative default ----------
  if (!responses.answered) {
    return {
      verdict: 'unknown',
      modifications: [
        {
          code: ReadinessMod.REDUCE_VOLUME,
          scope: 'session',
          reason: 'Chưa có thông tin sẵn sàng — giảm tải để an toàn.',
          payload: { volumeCapPct: UNKNOWN_CAP_PCT },
        },
      ],
      ruleVersion: RULE_VERSION,
    };
  }

  const mods: ReadinessModification[] = [];
  let verdict: ReadinessVerdict = 'ready';
  const bump = (v: ReadinessVerdict) => {
    // hold > modify > ready
    const rank = { ready: 0, modify: 1, hold: 2, unknown: 0 } as const;
    if (rank[v] > rank[verdict]) verdict = v;
  };

  // ---------- (1) Khó chịu / đau ----------
  const severeBlocking = responses.discomforts.filter(
    (d) => d.severity === 'severe' && d.affectsNormalMovement,
  );
  if (severeBlocking.length) {
    bump('hold');
    const blockedPatterns = new Set<string>();
    for (const d of severeBlocking) {
      const touched = itemsTouching(planned, d.bodyArea);
      for (const it of touched) blockedPatterns.add(it.movementPattern);
    }
    // nếu vùng đau chạm >= nửa số pattern của buổi -> hold cả buổi
    const totalPatterns = new Set(planned.map((p) => p.movementPattern)).size;
    if (totalPatterns > 0 && blockedPatterns.size >= Math.ceil(totalPatterns / 2)) {
      mods.push({
        code: ReadinessMod.HOLD_SESSION,
        scope: 'session',
        reason: 'Cơn đau ảnh hưởng vận động ở phần lớn buổi — tạm dừng cả buổi.',
      });
    } else {
      for (const pattern of blockedPatterns) {
        mods.push({
          code: ReadinessMod.HOLD_MOVEMENT_PATTERN,
          scope: 'movement_pattern',
          target: pattern,
          reason: `Tạm dừng nhóm động tác "${pattern}" vì đau ảnh hưởng vận động.`,
        });
      }
    }
  }

  for (const d of responses.discomforts) {
    if (d.severity === 'severe' && d.affectsNormalMovement) continue; // đã xử lý ở hold
    if (d.severity === 'moderate') {
      bump('modify');
      mods.push({
        code: ReadinessMod.AVOID_BODY_AREA,
        scope: 'body_area',
        target: d.bodyArea,
        reason: `Tránh tải trực tiếp lên vùng ${d.bodyArea} hôm nay.`,
      });
      for (const it of itemsTouching(planned, d.bodyArea)) {
        mods.push({
          code: ReadinessMod.SUBSTITUTE_EXERCISE,
          scope: 'exercise',
          target: it.exerciseId,
          reason: `Thay bài đụng vùng ${d.bodyArea} bằng bài an toàn hơn.`,
        });
      }
    } else if (d.severity === 'mild') {
      bump('modify');
      for (const it of itemsTouching(planned, d.bodyArea)) {
        mods.push({
          code: ReadinessMod.USE_REGRESSION,
          scope: 'exercise',
          target: it.exerciseId,
          reason: `Dùng biến thể dễ hơn cho bài đụng vùng ${d.bodyArea}.`,
        });
      }
    }
  }

  // ---------- (2) Mệt mỏi / tải ngoài ----------
  const loads = countExternalLoads(responses.externalLoads);
  const highFatigue =
    responses.residualSoreness === 'high' ||
    responses.energyLevel === 'low' ||
    loads >= 2;
  const moderateFatigue = responses.residualSoreness === 'moderate' || loads === 1;

  if (highFatigue) {
    bump('modify');
    mods.push({
      code: ReadinessMod.REDUCE_VOLUME,
      scope: 'session',
      reason: 'Mức hồi phục thấp — giảm khối lượng buổi hôm nay.',
      payload: { volumeCapPct: LOW_ENERGY_CAP_PCT },
    });
  } else if (moderateFatigue) {
    bump('modify');
    mods.push({
      code: ReadinessMod.REDUCE_VOLUME,
      scope: 'session',
      reason: 'Hồi phục chưa trọn vẹn — giảm nhẹ khối lượng.',
      payload: { volumeCapPct: MODERATE_CAP_PCT },
    });
  }

  return { verdict, modifications: mods, ruleVersion: RULE_VERSION };
}
