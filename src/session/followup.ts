// session/followup.ts
// DETERMINISTIC. Không LLM. §5.6 — quyết định CÓ schedule follow-up không + xử lý phản ứng ngày sau.
// Chỉ quyết định whether/when; side-effect (enqueue pg-boss) sống ở service.

import { DuringSessionSignal, DelayedSignal, ReadinessVerdict } from './tolerance';

export const FollowupTrigger = {
  ADAPTATION_PHASE: 'adaptation_phase',
  FIRST_EXPOSURE_TO_PATTERN: 'first_exposure_to_pattern',
  TOO_HARD_FEEDBACK: 'too_hard_feedback',
  PAIN_STOP_FEEDBACK: 'pain_stop_feedback',
  UNCOMFORTABLE_FEEDBACK: 'uncomfortable_feedback',
  READINESS_MODIFY_OR_HOLD: 'readiness_modify_or_hold',
} as const;
export type FollowupTriggerCode =
  (typeof FollowupTrigger)[keyof typeof FollowupTrigger];

export interface FollowupDecisionInput {
  adaptationActive: boolean;
  firstExposurePatterns: string[]; // pattern chưa từng có exposure tolerated
  during: DuringSessionSignal;
  readinessVerdict: ReadinessVerdict;
}

export interface FollowupDecision {
  schedule: boolean;
  triggers: FollowupTriggerCode[];
  delayHours: number;
  ruleVersion: string;
}

const RULE_VERSION = 'followup/v4.0';
const NEXT_DAY_HOURS = 20; // §14.5 "ngày hôm sau"

export function decideFollowup(input: FollowupDecisionInput): FollowupDecision {
  const triggers: FollowupTriggerCode[] = [];
  if (input.adaptationActive) triggers.push(FollowupTrigger.ADAPTATION_PHASE);
  if (input.firstExposurePatterns.length)
    triggers.push(FollowupTrigger.FIRST_EXPOSURE_TO_PATTERN);
  if (input.during.painStops > 0) triggers.push(FollowupTrigger.PAIN_STOP_FEEDBACK);
  if (input.during.tooHard > 0) triggers.push(FollowupTrigger.TOO_HARD_FEEDBACK);
  if (input.during.uncomfortable > 0)
    triggers.push(FollowupTrigger.UNCOMFORTABLE_FEEDBACK);
  if (input.readinessVerdict === 'modify' || input.readinessVerdict === 'hold')
    triggers.push(FollowupTrigger.READINESS_MODIFY_OR_HOLD);

  return {
    schedule: triggers.length > 0,
    triggers,
    delayHours: NEXT_DAY_HOURS,
    ruleVersion: RULE_VERSION,
  };
}

// ---- xử lý phản ứng ngày hôm sau ----

export interface FollowupReactions {
  feelWorse: boolean;
  newPainAppeared: boolean;
  sorenessLingering: boolean;
  recoveredWell: boolean;
}

export interface ReactionOutcome {
  requiresConservativeAction: boolean;
  delayedSignal: DelayedSignal;
  ruleVersion: string;
}

export function processFollowupReactions(
  r: FollowupReactions,
): ReactionOutcome {
  const requiresConservativeAction =
    r.feelWorse || r.newPainAppeared || r.sorenessLingering;
  return {
    requiresConservativeAction,
    delayedSignal: {
      worseNextDay: r.feelWorse,
      newPain: r.newPainAppeared,
      lingeringSoreness: r.sorenessLingering,
    },
    ruleVersion: RULE_VERSION,
  };
}
