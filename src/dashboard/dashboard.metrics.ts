/**
 * Pure derivations for the Home dashboard. No Prisma, no LLM — the service
 * fetches rows, these functions turn them into the numbers the client renders.
 * Kept separate so streak/adherence can be unit-tested with plain fixtures.
 *
 * `ruleVersion` for the derivations owned here. Bump when a definition changes
 * (e.g. streak switches from calendar-day to scheduled-day counting) so a reader
 * knows which meaning a value carried.
 */
export const dashboardRuleVersion = 'dashboard/v1.0';

/** Truncate a timestamp to its UTC calendar day (ms since epoch at 00:00Z). */
function dayKey(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** `YYYY-MM-DD` in UTC — the day-granular wire format for DashboardDay.date. */
export function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive calendar days ending today that have at least one completed
 * session. `now` establishes "today"; a session logged today extends the streak,
 * a gap of a full day breaks it. Returns 0 when there is no session today or
 * yesterday (a streak that has already lapsed reads as broken, not frozen).
 *
 * `completedAt` is each completed session's timestamp; order does not matter.
 */
export function computeStreak(completedAt: Date[], now: Date): number {
  if (completedAt.length === 0) return 0;

  const days = new Set(completedAt.map(dayKey));
  const today = dayKey(now);

  // A streak may legitimately not include today yet (no session logged today);
  // in that case it can still be "alive" through yesterday. But once yesterday
  // is also missing, the streak is over.
  let cursor = today;
  if (!days.has(today)) {
    cursor = today - DAY_MS;
    if (!days.has(cursor)) return 0;
  }

  let streak = 0;
  while (days.has(cursor)) {
    streak++;
    cursor -= DAY_MS;
  }
  return streak;
}

/**
 * Adherence = completed ÷ due, clamped to 0..1. An empty window (no due days)
 * is treated as fully adherent (1) — a user with nothing scheduled yet has not
 * fallen behind. Mirrors the mobile mock's `adherenceAsOf` (empty → 1).
 */
export function computeAdherence(done: number, due: number): number {
  if (due <= 0) return 1;
  const ratio = done / due;
  return ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
}

/** A logged set reduced to the two fields volume needs. */
export interface VolumeSet {
  actualWeightKg: number | null;
  actualReps: number | null;
}

/**
 * Total working volume for a session: Σ(weight × reps) over its sets, rounded to
 * whole kg. Sets missing either field contribute 0 (a bodyweight or
 * duration-only set has no weighted volume).
 */
export function computeVolumeKg(sets: VolumeSet[]): number {
  const total = sets.reduce((sum, s) => {
    const w = s.actualWeightKg ?? 0;
    const r = s.actualReps ?? 0;
    return sum + w * r;
  }, 0);
  return Math.round(total);
}
