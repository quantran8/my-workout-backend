# `session` — business logic

| | |
|---|---|
| **unit** | `src/session` |
| **kind** | `feature` |
| **status** | `live` |
| **last_updated** | `2026-07-23` |

**Source paths**

- [`session.controller.ts`](../../../../src/session/session.controller.ts) — the lifecycle routes
- [`session.service.ts`](../../../../src/session/session.service.ts) — orchestration
- [`readiness.ts`](../../../../src/session/readiness.ts) — **deterministic** pre-session gate
- [`execution-snapshot.ts`](../../../../src/session/execution-snapshot.ts) — **deterministic** immutable snapshot
- [`pain-stop.ts`](../../../../src/session/pain-stop.ts), [`tolerance.ts`](../../../../src/session/tolerance.ts), [`session-feedback.ts`](../../../../src/session/session-feedback.ts), [`followup.ts`](../../../../src/session/followup.ts)

---

## 1. Purpose

Owns a workout from "about to start" to "logged and evaluated": the safety gate, the immutable record of what was actually asked of the user, what they did, and how they reacted.

---

## 2. Flow

```
POST /session/create        shell row; environment + distanceSource captured UP FRONT
POST /session/:id/readiness assessReadiness (CODE) → verdict + modifications
POST /session/:id/execution buildExecutionSnapshot (CODE) → immutable items, exercises hydrated
POST /session/:id/sets      LoggedSet[]  (append-able)
POST /session/:id/feedback  ExerciseFeedbackEvent, incl. pain_stop
POST /session/:id/complete  sessionRpe → feedback + tolerance → schedule next-day follow-up

POST /session               one-shot legacy path (whole session in one call)
```

---

## 3. Business logic

### `SESSION-1` — skipping the readiness gate is a decision, and it costs 30% volume

- **Trigger** — `POST /session/:id/execution` with no readiness row.
- **Effect** — treated as `answered: false` → verdict `unknown` → `UNKNOWN_CAP_PCT = 70`, i.e. volume capped at 70%.
- **Thresholds** — `LOW_ENERGY_CAP_PCT = 60`, `MODERATE_CAP_PCT = 80`.
- **Why** — an unknown state is not a safe state. The conservative branch is deliberate, not a fallback.
- **Code** — [`session.service.ts:353`](../../../../src/session/session.service.ts#L353); [`readiness.ts:63`](../../../../src/session/readiness.ts#L63)

### `SESSION-2` — `hold` blocks only what it names

- **Effect** — `HOLD_SESSION` holds everything; `HOLD_MOVEMENT_PATTERN` holds only items with that pattern; `AVOID_BODY_AREA` drives substitution. Precedence: hold > modify > ready.
- **Edge cases** — §12.2: a `hold` verdict does **not** cancel the whole session unless the modification says so. Exercises untouched by the painful area still train.
- **Code** — [`readiness.ts`](../../../../src/session/readiness.ts); [`execution-snapshot.ts:99`](../../../../src/session/execution-snapshot.ts#L99)

### `SESSION-3` — the execution snapshot is immutable, and it is the yardstick

- **Trigger** — `POST /session/:id/execution`.
- **Effect** — persists `plannedRx` **and** `effectiveRx` per item. Progress and tolerance are measured against `effectiveRx`, never `plannedRx`.
- **Edge cases** — re-calling the endpoint returns the existing items instead of writing duplicates (clients re-call it when resuming). Only `status` may change afterwards, and only via the pain-stop rule.
- **Why** — judging a reduced session against the original prescription would read as failure when the user did exactly what was asked.
- **Code** — [`session.service.ts:321`](../../../../src/session/session.service.ts#L321) — `buildExecution`

### `SESSION-4` — no substitution library yet, so substitution degrades to skip

- **Condition** — a modification asks for `SUBSTITUTE_EXERCISE`.
- **Effect** — `resolveSubstitute` returns null in v1 → falls back to a regression → if none, the item is **skipped**.
- **Why** — skipping is safe; guessing a replacement is not.
- **Code** — [`session.service.ts:369`](../../../../src/session/session.service.ts#L369); [`execution-snapshot.ts:132`](../../../../src/session/execution-snapshot.ts#L132)

### `SESSION-5` — execution items are returned with their exercise hydrated

- **Effect** — each item carries the full `Exercise` row (name, muscles, instructions, media) and any interval `blocks` from its source prescription.
- **Edge cases** — `exercise` is null when the movement is missing or no longer reviewed; the client renders the rest rather than failing the session. Only `reviewedBy != null` rows are joined, consistent with `PROFILE-5`.
- **Why** — without this the client receives only UUIDs and cannot render an exercise list at all.
- **Code** — [`session.service.ts:421`](../../../../src/session/session.service.ts#L421) — `hydrateExercises`

### `SESSION-6` — `environment` and `distanceSource` are captured at creation

- **Trigger** — `POST /session/create`.
- **Why** — §5B: outdoor vs. indoor changes how pace and distance are interpreted, and `distanceSource` sets how much the distance can be trusted. Both are unrecoverable after the fact.
- **Edge cases** — omitted fields fall back to the column defaults (`unknown` / `none` / `manual`), which are the honest values.
- **Code** — [`create-session.dto.ts`](../../../../src/session/dto/create-session.dto.ts); [`session.service.ts:230`](../../../../src/session/session.service.ts#L230)

### `SESSION-7` — `pain_stop` is an event, not a set flag

- **Effect** — `RecordFeedbackDto.type` accepts `pain_stop`; `LoggedSet.feedbackFlag` does not (`too_easy` / `too_hard` / `uncomfortable` / `ok` only). Pain carries optional `bodyArea` and `severity` 1–5 and triggers the pain-stop rule and a follow-up.
- **Why** — pain is about the *user*, not about one set's difficulty; conflating them would lose the signal that blocks a movement pattern later.
- **Code** — [`record-feedback.dto.ts`](../../../../src/session/dto/record-feedback.dto.ts); [`pain-stop.ts`](../../../../src/session/pain-stop.ts)

### `SESSION-8` — whole-session effort is recorded at completion

- **Trigger** — `POST /session/:id/complete` with an optional body.
- **Effect** — `sessionRpe` (1–10), `energyAfter`, `notes` are persisted **before** feedback and tolerance are computed.
- **Edge cases** — the body is optional; a client that posts nothing still completes the session.
- **Why** — session RPE is distinct from a set's `actualRpe` and can only be collected at the end.
- **Code** — [`complete-session.dto.ts`](../../../../src/session/dto/complete-session.dto.ts); [`session.service.ts:567`](../../../../src/session/session.service.ts#L567)

### `SESSION-9` — completion schedules a next-day follow-up

- **Effect** — `completeSession` computes feedback + tolerance, then `decideFollowup` may enqueue a `followup.due` job.
- **Edge cases** — the follow-up asks whether the user felt worse the next day; its answers feed tolerance, which can revise the program for safety.
- **Code** — [`session.service.ts`](../../../../src/session/session.service.ts) — `completeSession`; [`followup.service.ts`](../../../../src/session/followup.service.ts)

### `SESSION-10` — a free workout is a valid session with no plan

- **Condition** — `plannedSessionId` is null.
- **Effect** — `buildExecution` returns `{ items: [] }`, marks the session in-progress, and does not error. Sets logged against it have a null `prescriptionId`.
- **Code** — [`session.service.ts:324`](../../../../src/session/session.service.ts#L324)

---

## 4. State held

| Row | Tracks |
|---|---|
| `WorkoutSession` | status, environment, distanceSource, dataSource, timing, sessionRpe, wearable |
| `SessionReadiness` | verdict + modifications + `ruleVersion` |
| `SessionExecutionItem` | plannedRx, effectiveRx, appliedModifications, status |
| `LoggedSet` | what was actually performed, with per-field sources |
| `ExerciseFeedbackEvent` | including `pain_stop`, with body area and severity |
| `PostSessionFollowup` | next-day reaction |

---

## 5. Dependencies

- **Memory** — [`profile`](../profile/profile.md) (injury vocabulary, adaptation caps), [`program`](../program/program.md) (prescriptions + blocks).
- **Services** — `pg-boss` for follow-up scheduling.
- **Cross-repo** — [mobile practice memory](../../../../../mobile/.claude/memory/features/practice/practice.md).

---

## 6. Known gotchas

- `ruleVersion` is stored per readiness/execution row (`readiness/v4.0`, `execution/v4.0`). **Bump it whenever a threshold changes**, or old verdicts become indistinguishable from new ones.
- `dataSource` records how automated the capture was and must **not** enter any verdict formula — it is metadata about trust, not a safety input.
- `POST /session` (one-shot) is legacy back-compat and bypasses readiness and the execution snapshot entirely. New clients use the granular lifecycle.
- `getSession` also hydrates execution items, so resuming a session renders exercise names without re-running `execution`.

---

## 7. Change log

- `2026-07-23` — Claude — initial version: lifecycle, readiness gate, execution snapshot, pain-stop, completion + follow-up.
