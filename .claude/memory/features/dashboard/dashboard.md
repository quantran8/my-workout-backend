# `dashboard` — business logic

| | |
|---|---|
| **unit** | `src/dashboard` |
| **kind** | `feature` |
| **status** | `live` |
| **last_updated** | `2026-07-24` |

**Source paths**

- [`dashboard.controller.ts`](../../../../src/dashboard/dashboard.controller.ts) — `GET /dashboard`, auth'd, thin
- [`dashboard.service.ts`](../../../../src/dashboard/dashboard.service.ts) — reads source rows, assembles the response
- [`dashboard.metrics.ts`](../../../../src/dashboard/dashboard.metrics.ts) — pure derivations (streak, adherence, volume)
- [`dashboard.types.ts`](../../../../src/dashboard/dashboard.types.ts) — `DashboardResponse` wire shape

---

## 1. Purpose

Serves the mobile Home screen a single read-only aggregate: streak, adherence, the week's scheduled/completed days, the next session to do, and the most recent completed session. It only reads and derives — no writes, no LLM.

Peer contract: the mobile app's `home` feature (`mobile/.claude/memory/features/home/home.md`) deserializes `DashboardResponse` into its `SessionLog` / `ProgressReport` / `PlanSession` models. The two are peers — a field renamed here without the app is a broken screen.

---

## 2. Flow

Single endpoint, no sequence:

```
GET /dashboard  → AuthGuard → getUserId(req) → DashboardService.getDashboard(userId)
  1. active Program → latest revision → planned days (week/day order)
  2. all completed WorkoutSessions (status=completed), newest first
  3. User.tier
  4. derive streak / adherence / next / recent → DashboardResponse
     ↳ no active program / no sessions: days=[], next=null, recent=null,
       streak=0, adherence=1, tier from User. Screen renders empty, never errors.
```

---

## 3. Business logic

### `DASHBOARD-1` — completed = `WorkoutSession.status: 'completed'`

- **Trigger** — every dashboard read.
- **Condition** — a session counts as done only when its `status` is `completed`; `planned` / `in_progress` / `aborted` / `held` do not.
- **Effect** — feeds `done`, `baselineSessions`, the `days` list, `streak`, and `recent`.
- **Code** — [`dashboard.service.ts`](../../../../src/dashboard/dashboard.service.ts#L53) — `where: { userId, status: 'completed' }`

### `DASHBOARD-2` — streak is consecutive calendar days ending today

- **Trigger** — every read.
- **Condition** — count back from today (UTC calendar day of `now`) over days that have ≥1 completed session. A session today extends the streak; if today has none but yesterday does, the streak is still alive through yesterday; once neither today nor yesterday has a session, streak is 0.
- **Effect** — `streak: int`. Multiple sessions on one day collapse to a single day.
- **Why** — mirrors the mobile mock `streakAsOf`: a lapsed streak reads as broken, not frozen, so the number cannot lie about momentum.
- **Code** — [`dashboard.metrics.ts`](../../../../src/dashboard/dashboard.metrics.ts#L32) — `computeStreak`

### `DASHBOARD-3` — adherence = done ÷ due over reached planned days; empty → 1

- **Trigger** — every read.
- **Condition** — `done` = count of completed sessions. `due` = planned days the user has *reached*: every planned day already backed by a completed session, plus the current next one. Planned days beyond next are future, not yet due.
- **Effect** — `adherence: double` clamped 0..1; `due` and `done` returned alongside for the caption.
- **Edge cases** — `due = 0` (nothing scheduled yet) → adherence `1`, not a divide-by-zero. `done > due` → clamped to `1`.
- **Why** — `PlannedSession` has **no calendar date** (only `weekNumber`/`dayNumber`), so a true "days elapsed vs. scheduled" window is not computable server-side. Reach-based counting is the defensible substitute and matches how "next session" is chosen.
- **Code** — [`dashboard.service.ts`](../../../../src/dashboard/dashboard.service.ts#L90) (due), [`dashboard.metrics.ts`](../../../../src/dashboard/dashboard.metrics.ts#L60) — `computeAdherence`

### `DASHBOARD-4` — next session = first planned day with no completed session

- **Trigger** — every read.
- **Condition** — walk planned days in `weekNumber, dayNumber` order; the first whose `id` is not referenced by any completed session's `plannedSessionId` is next. All logged → `nextSession: null` (rest / all-done hero state).
- **Effect** — `{ plannedSessionId, programRevisionId, name: focus, durationMin: 45, exercises: prescriptions.length }`. `programRevisionId` is the active revision the planned day belongs to — the client needs it to start the session (`POST /session/create` takes it), and carrying it here saves a second call to the program endpoint. `durationMin` is a fixed 45 — `PlannedSession` stores no per-session duration and 45 is the app's hero default.
- **Edge cases** — `nextSession` is null unless **both** a next planned day and a revision id exist; a program with no revision (should not happen) degrades to null rather than emitting a half-formed session the client cannot start.
- **Code** — [`dashboard.service.ts`](../../../../src/dashboard/dashboard.service.ts#L83) — `nextPlanned`, `buildNextSession`

### `DASHBOARD-5` — recent session volume = Σ(actualWeightKg × actualReps)

- **Trigger** — every read, when ≥1 completed session exists.
- **Condition** — the newest completed session; volume sums `weight × reps` over its `LoggedSet`s, rounded to whole kg. Sets missing weight or reps contribute 0 (bodyweight / duration-only). `exercises` = distinct `exerciseId` count.
- **Effect** — `recent: { sessionId, name, volumeKg, exercises, completedAt }`; `null` before the first session.
- **Edge cases** — ad-hoc session (`plannedSessionId` null) → `name` falls back to `"workout"` (client localizes); never a blank row.
- **Why** — `WorkoutSession.plannedSessionId` is a **soft FK** (no Prisma relation), so the workout name is fetched with a separate `plannedSession.findUnique`.
- **Code** — [`dashboard.service.ts`](../../../../src/dashboard/dashboard.service.ts#L133) — `buildRecent`; [`dashboard.metrics.ts`](../../../../src/dashboard/dashboard.metrics.ts#L77) — `computeVolumeKg`

### `DASHBOARD-6` — access tier from `User.tier`, lower-cased on the wire

- **Trigger** — every read.
- **Condition** — `User.tier` is the Prisma enum `Tier` (`FREE` | `PAID`); the wire value is lower-case `free` | `paid`.
- **Effect** — `accessTier`. Drives the client's Progress card paywall.
- **Code** — [`dashboard.service.ts`](../../../../src/dashboard/dashboard.service.ts#L112) — `user?.tier === 'PAID' ? 'paid' : 'free'`

---

## 4. State held

Stateless. Reads `Program` / `ProgramRevision` / `PlannedSession` / `WorkoutSession` / `LoggedSet` / `User`; writes nothing.

---

## 5. Dependencies

- **Memory** — [`session`](../session/session.md) — `WorkoutSession.status` lifecycle and `LoggedSet` semantics. [`program`](../program/program.md) — the active-program → revision → planned-day shape.
- **Services** — `PrismaService` (global) — all reads, scoped `where: { userId }`.
- **Cross-repo** — `GET /api/v1/dashboard` → mobile `home` feature (`mobile/.claude/memory/features/home/home.md`). `DashboardResponse` maps to `SessionLog` (`days`, `baselineSessions`), `ProgressReport` (derived client-side from `baselineSessions`), the hero `PlanSession` (`nextSession`), and the recent row.

---

## 6. Known gotchas

- **`WorkoutSession.plannedSessionId` is a soft FK** — no Prisma relation on it (the relation at `schema.prisma:174` is `Prescription`'s). The workout name for the recent row is a separate `plannedSession.findUnique`, not an `include`.
- **`PlannedSession` has no date.** `days[].date` is derived from each completed session's `startedAt`; the planned sequence is week/day-ordered only. This is why adherence uses reach-based `due` (DASHBOARD-3) rather than a calendar window.
- **Mobile is not yet wired.** As of this version the app's Home still runs on a local `SessionLog` seed and hardcoded `accessTier`; `ApiPlanRepository` and a dashboard provider are not activated. This endpoint exists ahead of that wiring — when the app switches over, verify field names against `DashboardResponse` here.
- **`ProgressRollup` is deliberately not read.** It is PAID/reserved and may be empty; the Progress card is derived client-side from `baselineSessions`, so the dashboard does not touch it.

---

## 7. Change log

- `2026-07-24` — Claude — initial version: `GET /dashboard` aggregate for the Home screen (streak, adherence, next/recent, tier). Metrics are pure functions (`dashboard/v1.0`).
- `2026-07-24` — Claude — `DASHBOARD-4`: `nextSession` now carries `programRevisionId` so the mobile practice flow can start the session without a second call. Peer: mobile `home`/`practice` memory.
