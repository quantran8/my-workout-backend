/**
 * Wire shapes for GET /api/v1/dashboard — the aggregate the mobile Home screen
 * consumes. Every field maps to a Dart model in the app's `home` feature; keep
 * the names and enum vocabulary in lockstep with the peer memory file
 * (mobile `.claude/memory/features/home/home.md`).
 *
 * Response is built inline in the service (like Program) and returned raw; there
 * is no DTO class because the endpoint takes no request body.
 */

/** One scheduled training day, day-granular, oldest first. `date` is `YYYY-MM-DD`. */
export interface DashboardDay {
  date: string;
  completed: boolean;
}

/** The hero card's "do this next" session. Null once every planned day is logged. */
export interface DashboardNextSession {
  plannedSessionId: string;
  /**
   * The active program revision this planned day belongs to. Required to start
   * the session — `POST /session/create` takes `programRevisionId`. Carried here
   * so the client does not need a second call to the program endpoint.
   */
  programRevisionId: string;
  /** Plan day focus, shown as the session name on the hero card. */
  name: string;
  durationMin: number;
  exercises: number;
}

/** The most recently completed session, for the Recent row. Null before the first. */
export interface DashboardRecentSession {
  sessionId: string;
  name: string;
  /** Σ(actualWeightKg × actualReps) across logged sets, rounded to whole kg. */
  volumeKg: number;
  exercises: number;
  completedAt: string;
}

/**
 * Whole-program progress: how many planned sessions the user has completed out of
 * the program's total (durationWeeks × training-days-per-week). Distinct from
 * `due`/`adherence` (a reach-based window) — this is the absolute "X of M" the plan
 * spans end to end. `total` is 0 when there is no active program.
 */
export interface DashboardProgramProgress {
  completed: number;
  total: number;
}

export interface DashboardResponse {
  sessionLog: {
    days: DashboardDay[];
    /** Distinct comparable completed sessions; gates the Progress card client-side. */
    baselineSessions: number;
  };
  /** "X of M sessions in the whole program" — see DASHBOARD-7. */
  programProgress: DashboardProgramProgress;
  /** Consecutive calendar days with a completed session, counting back from today. */
  streak: number;
  /** completed ÷ due within the window, 0..1. Empty window → 1. */
  adherence: number;
  /** Planned days already due as of now. */
  due: number;
  /** Completed sessions as of now. */
  done: number;
  /** Subscription boundary. Wire is snake/lower-case: `free` | `paid`. */
  accessTier: 'free' | 'paid';
  nextSession: DashboardNextSession | null;
  recent: DashboardRecentSession | null;
}
