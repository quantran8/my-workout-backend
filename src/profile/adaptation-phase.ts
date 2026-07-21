// profile/adaptation-phase.ts
// DETERMINISTIC. Không LLM. §2 — adaptation phase là TRẠNG THÁI riêng có trigger + exit criteria.
// Ở trong profile/ để feed guardrail (buildGuardrail đọc caps) mà không tạo vòng import chéo.
// caps (volume/difficulty/impact) do CODE quyết; exit dựa trên tolerance thực tế (§2), không chỉ số ngày.

import { Profile } from './profile.types';

export const AdaptationTrigger = {
  BEGINNER: 'beginner',
  RECENT_ACTIVITY_VERY_LOW: 'recent_activity_very_low',
  LONG_DETRAINING: 'long_detraining',
  UNKNOWN_TOLERANCE: 'unknown_tolerance',
  RETURNING_AFTER_BAD_REACTION: 'returning_after_bad_reaction',
} as const;
export type AdaptationTriggerCode =
  (typeof AdaptationTrigger)[keyof typeof AdaptationTrigger];

export type AdaptationStatus = 'active' | 'exited' | 'none';

export interface AdaptationCaps {
  volumeCapPct: number; // vd 60
  difficultyCap: number; // vd 3 -> feed guardrail maxDiff
  impactCap: 'low' | 'moderate' | 'high';
}

export interface AdaptationState {
  status: AdaptationStatus;
  triggers: AdaptationTriggerCode[];
  caps: AdaptationCaps | null; // null khi status !== 'active'
  consecutiveToleratedSessions: number;
  ruleVersion: string;
}

export interface AdaptationHistory {
  hadBadReaction: boolean;
  toleranceKnown: boolean;
}

const RULE_VERSION = 'adaptation/v4.0';
const LONG_DETRAINING_WEEKS = 12;
const EXIT_CONSECUTIVE_TOLERATED = 3;

// caps chặt nhất theo trigger mạnh nhất
const STRICT_CAPS: AdaptationCaps = {
  volumeCapPct: 50,
  difficultyCap: 2,
  impactCap: 'low',
};
const STANDARD_CAPS: AdaptationCaps = {
  volumeCapPct: 60,
  difficultyCap: 3,
  impactCap: 'low',
};

/** phát hiện trigger từ profile + history. */
export function detectAdaptationTriggers(
  profile: Profile,
  history: AdaptationHistory,
): AdaptationTriggerCode[] {
  const c = profile.constraint;
  const triggers: AdaptationTriggerCode[] = [];
  if (c.experienceLevel === 'beginner') triggers.push(AdaptationTrigger.BEGINNER);
  if (c.recentActivityLevel === 'very_low')
    triggers.push(AdaptationTrigger.RECENT_ACTIVITY_VERY_LOW);
  if ((c.detrainingDurationWeeks ?? 0) >= LONG_DETRAINING_WEEKS)
    triggers.push(AdaptationTrigger.LONG_DETRAINING);
  if (!history.toleranceKnown) triggers.push(AdaptationTrigger.UNKNOWN_TOLERANCE);
  if (history.hadBadReaction)
    triggers.push(AdaptationTrigger.RETURNING_AFTER_BAD_REACTION);
  return triggers;
}

function capsFor(triggers: AdaptationTriggerCode[]): AdaptationCaps {
  const strict =
    triggers.includes(AdaptationTrigger.RETURNING_AFTER_BAD_REACTION) ||
    triggers.includes(AdaptationTrigger.LONG_DETRAINING);
  return strict ? { ...STRICT_CAPS } : { ...STANDARD_CAPS };
}

/**
 * state machine thuần: current + triggers + consecutiveTolerated (từ tolerance rollup) -> next state.
 * - none/null + triggers -> active (caps theo trigger mạnh nhất)
 * - active -> exited khi consecutiveTolerated >= 3
 * - re-entry -> active nếu có bad reaction mới
 */
export function stepAdaptationPhase(
  current: AdaptationState | null,
  triggers: AdaptationTriggerCode[],
  consecutiveToleratedSessions: number,
): AdaptationState {
  const hasNewBadReaction = triggers.includes(
    AdaptationTrigger.RETURNING_AFTER_BAD_REACTION,
  );

  // re-entry: bad reaction mới ép quay lại active bất kể trạng thái
  if (hasNewBadReaction) {
    return {
      status: 'active',
      triggers,
      caps: capsFor(triggers),
      consecutiveToleratedSessions: 0,
      ruleVersion: RULE_VERSION,
    };
  }

  const isActive = current?.status === 'active';

  if (!isActive) {
    if (triggers.length === 0) {
      return {
        status: 'none',
        triggers: [],
        caps: null,
        consecutiveToleratedSessions,
        ruleVersion: RULE_VERSION,
      };
    }
    return {
      status: 'active',
      triggers,
      caps: capsFor(triggers),
      consecutiveToleratedSessions,
      ruleVersion: RULE_VERSION,
    };
  }

  // đang active: exit theo tolerance thực tế
  if (consecutiveToleratedSessions >= EXIT_CONSECUTIVE_TOLERATED) {
    return {
      status: 'exited',
      triggers,
      caps: null,
      consecutiveToleratedSessions,
      ruleVersion: RULE_VERSION,
    };
  }
  return {
    status: 'active',
    triggers,
    caps: capsFor(triggers),
    consecutiveToleratedSessions,
    ruleVersion: RULE_VERSION,
  };
}
