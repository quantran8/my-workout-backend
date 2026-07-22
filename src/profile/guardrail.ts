// profile/guardrail.ts
// DETERMINISTIC. Không LLM. Port từ guardrail.py.
// Đọc flags + injuries + movement library -> policy + pool đã lọc + messages.
// LLM sinh chương trình CHỈ chọn trong allowedPool và PHẢI tuân policy.

import { Profile, RedFlag, Action } from './profile.types';
import { computeFlags } from './flags';
import type { AdaptationCaps } from './adaptation-phase';

const IMPACT_RANK: Record<string, number> = { low: 1, moderate: 2, high: 3 };

// Shape tối thiểu của một exercise từ movement library (khớp §2).
export interface Exercise {
  exerciseId: string; // uuid v7 — khoá thật, dùng cho mọi FK khi ghi DB
  slug: string; // key người đọc được ("Barbell_Squat") — đây là thứ gửi cho LLM
  name: string;
  exerciseType: 'resistance' | 'cardio' | 'mobility';
  equipment: string[];
  difficulty: number;
  contraindications: { injuryArea: string; reason?: string }[];
  [k: string]: unknown;
}

export interface GuardrailPolicy {
  allowCalorieDeficit: boolean;
  allowAggressiveSurplus: boolean;
  conservativeStart: boolean;
  requireGuardian: boolean;
  mustResolveGoalConflict: boolean;
  maxWeeklySetsPerMuscle: number | null;
  blockedInjuryAreas: string[];
  goalPhasePriority: string[] | null;
  // §2 — caps của adaptation phase active (null nếu không có phase)
  adaptationVolumeCapPct: number | null;
  adaptationDifficultyCap: number | null;
  adaptationImpactCap: string | null;
}

export interface GuardrailResult {
  flags: RedFlag[];
  policy: GuardrailPolicy;
  allowedPool: Exercise[];
  excluded: { exerciseId: string; slug: string; name: string; reasons: string[] }[];
  userMessages: string[];
  safetyNote: string;
}

export function buildGuardrail(
  profile: Profile,
  library: Exercise[],
  adaptation?: AdaptationCaps | null, // §2 — caps của adaptation phase active (non-breaking optional)
): GuardrailResult {
  const { flags } = computeFlags(profile);
  const actions = new Set(flags.flatMap((f) => f.actions));
  const c = profile.constraint;

  // ---------- (1) POLICY cứng ----------
  const policy: GuardrailPolicy = {
    allowCalorieDeficit: !actions.has(Action.NO_CALORIE_DEFICIT),
    allowAggressiveSurplus: !actions.has(Action.NO_AGGRESSIVE_SURPLUS),
    conservativeStart: actions.has(Action.CONSERVATIVE_START),
    requireGuardian: actions.has(Action.REQUIRE_GUARDIAN),
    mustResolveGoalConflict: actions.has(Action.RESOLVE_GOAL_CONFLICT),
    maxWeeklySetsPerMuscle: null,
    blockedInjuryAreas: [],
    goalPhasePriority: null,
    adaptationVolumeCapPct: adaptation?.volumeCapPct ?? null,
    adaptationDifficultyCap: adaptation?.difficultyCap ?? null,
    adaptationImpactCap: adaptation?.impactCap ?? null,
  };
  for (const f of flags) {
    if (f.actions.includes(Action.VOLUME_CAP)) {
      const cap = f.payload['maxWeeklySetsPerMuscle'];
      if (typeof cap === 'number') policy.maxWeeklySetsPerMuscle = cap;
    }
    if (f.actions.includes(Action.BLOCK_EXERCISE_AREA)) {
      const area = f.payload['area'];
      if (typeof area === 'string') policy.blockedInjuryAreas.push(area);
    }
    if (f.actions.includes(Action.RESOLVE_GOAL_CONFLICT)) {
      const pr = f.payload['suggestedPriority'];
      if (Array.isArray(pr)) policy.goalPhasePriority = pr as string[];
    }
  }

  // ---------- (2) LỌC POOL ----------
  const blocked = new Set(policy.blockedInjuryAreas);
  const allowedEquip =
    c.equipment && c.equipment.length ? new Set([...c.equipment, 'bodyweight']) : null;
  // §2: maxDiff = min(base thận trọng, difficultyCap của adaptation phase active)
  const baseMaxDiff = policy.conservativeStart ? 3 : 5;
  const maxDiff = adaptation
    ? Math.min(baseMaxDiff, adaptation.difficultyCap)
    : baseMaxDiff;
  const maxImpactRank = adaptation ? IMPACT_RANK[adaptation.impactCap] : null;

  const allowedPool: Exercise[] = [];
  const excluded: GuardrailResult['excluded'] = [];

  for (const ex of library) {
    const reasons: string[] = [];
    const contraAreas = new Set((ex.contraindications ?? []).map((ci) => ci.injuryArea));
    const hit = [...blocked].filter((a) => contraAreas.has(a));
    if (hit.length) reasons.push(`contraindication: ${hit.join(',')}`);
    if ((ex.difficulty ?? 3) > maxDiff) reasons.push(`difficulty>${maxDiff}`);
    if (allowedEquip && !(ex.equipment ?? []).some((e) => allowedEquip.has(e))) {
      reasons.push('thiếu thiết bị');
    }
    // §2 impact cap (chỉ khi adaptation phase active và bài có impactLevel)
    if (maxImpactRank != null) {
      const impact = ex.impactLevel;
      if (typeof impact === 'string' && (IMPACT_RANK[impact] ?? 0) > maxImpactRank) {
        reasons.push(`impact>${adaptation!.impactCap}`);
      }
    }
    if (reasons.length)
      excluded.push({ exerciseId: ex.exerciseId, slug: ex.slug, name: ex.name, reasons });
    else allowedPool.push(ex);
  }

  // ---------- (3) MESSAGES ----------
  const userMessages = flags.map((f) => f.message).filter((m): m is string => !!m);

  return {
    flags,
    policy,
    allowedPool,
    excluded,
    userMessages,
    safetyNote:
      'LLM sinh chương trình CHỈ chọn từ allowedPool và PHẢI tuân policy. Không được vượt rào.',
  };
}
