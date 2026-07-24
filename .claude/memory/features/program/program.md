# `program` — business logic

| | |
|---|---|
| **unit** | `src/program` |
| **kind** | `feature` |
| **status** | `live` |
| **last_updated** | `2026-07-24` |

**Source paths**

- [`program.service.ts`](../../../../src/program/program.service.ts) — generate / persist / revise / current
- [`program-validator.ts`](../../../../src/program/program-validator.ts) — **trust but verify** over the LLM
- [`program.helpers.ts`](../../../../src/program/program.helpers.ts) — draft → Program assembly, weekday derivation
- [`calendar.ts`](../../../../src/program/calendar.ts) — **deterministic** date → (week, day) resolution + progress total
- [`pool-retrieval.ts`](../../../../src/program/pool-retrieval.ts) — the slim pool sent to the LLM
- [`nutrition.ts`](../../../../src/program/nutrition.ts) — deterministic calorie/protein target (not the LLM)
- [`program.types.ts`](../../../../src/program/program.types.ts) — Prescription + interval blocks + `CurrentResponse`/`SessionPointer`

---

## 1. Purpose

Turns a saved profile into a training program: the LLM drafts it, deterministic code verifies it against the guardrail, and only a clean draft is persisted.

---

## 2. Flow

```
generate
  1. profile + guardrail (policy + allowedPool)
  2. startDate = today; trainingDays = trainingDaysFromProfile (CODE, not LLM)
  3. pool-retrieval → slim pool (~2K tokens) sent to the LLM
  4. LLM → ProgramDraft (no ids, no type; carries durationWeeks)
  5. assembleProgram → ids assigned, slug kept; startDate/trainingDays attached
  6. validateProgram → violations?  yes → re-prompt with them  /  no → persist
  7. persist: Program(+durationWeeks/startDate/trainingDays) + Revision + PlannedSession + Prescription (+ PrescriptionBlock)

current  (GET /program/current?date=)
  active program → calendar.resolveDate(date) → training | rest | before_start |
  program_complete | no_program.  training → the matching PlannedSession, hydrated.
  Always carries nextSession (next unlogged planned day) + programRevisionId +
  progress { completed, total }, so a rest day is still startable.
```

---

## 3. Business logic

### `PROGRAM-1` — the LLM never chooses an exercise outside the pool

- **Trigger** — validation of the draft.
- **Effect** — every `exerciseSlug` must be in `guard.allowedPool`, else `EXERCISE_NOT_IN_POOL`.
- **Why** — the pool is already filtered for review status and the user's injuries (`PROFILE-5`). A hallucinated or blocked movement must never persist.
- **Edge cases** — the LLM speaks **slug**; the DB speaks uuid v7. `assembleProgram` keeps the slug for validation and maps it to `exerciseId`; an unmapped slug becomes `''` and is caught as this violation.
- **Code** — [`program-validator.ts:42`](../../../../src/program/program-validator.ts#L42); [`program.helpers.ts:33`](../../../../src/program/program.helpers.ts#L33)

### `PROGRAM-2` — violations are fed back to the LLM, not silently patched

- **Effect** — a failed validation re-prompts with `previousViolations`; code never edits the draft into compliance.
- **Why** — silently fixing hides a model that does not understand the constraint, and the fix would itself be unreviewed.
- **Code** — [`program.service.ts`](../../../../src/program/program.service.ts) — generate loop

### `PROGRAM-3` — weekly volume per muscle is capped

- **Condition** — `policy.maxWeeklySetsPerMuscle != null` (beginners: 10).
- **Effect** — sets are summed per `(week, primaryMuscle)` from the pool's data; exceeding the cap is `VOLUME_CAP_EXCEEDED`.
- **Code** — [`program-validator.ts:99`](../../../../src/program/program-validator.ts#L99)

### `PROGRAM-4` — a goal conflict forces phasing and minimal cardio

- **Condition** — `policy.mustResolveGoalConflict` (set by `PROFILE-4`).
- **Effect** — a missing `phasePlan` is `PHASE_PLAN_MISSING`; more than `CARDIO_MINIMAL_MAX_SESSIONS = 2` cardio sessions in a week is `CARDIO_NOT_MINIMAL`.
- **Why** — cardio burns the surplus needed to gain weight. Strength first, endurance second.
- **Code** — [`program-validator.ts:126`](../../../../src/program/program-validator.ts#L126)

### `PROGRAM-5` — sessions per week must match the user's stated schedule

- **Effect** — a week whose session count differs from `expectedDaysPerWeek` is `SESSION_COUNT_MISMATCH`.
- **Code** — [`program-validator.ts:150`](../../../../src/program/program-validator.ts#L150)

### `PROGRAM-6` — interval blocks are cardio-only, contiguous, and measurable

- **Condition** — a prescription carries `blocks`.
- **Effect** — three checks:
  - the exercise must be `exerciseType === 'cardio'` → else `BLOCKS_ON_NON_CARDIO`;
  - `order` must be exactly `1..n`, no gaps or duplicates → else `BLOCK_ORDER_INVALID`;
  - each block needs `durationSec` **or** `distanceM` → else `BLOCK_NO_DIMENSION`.
- **Why** — the client runs blocks sequentially by `order`; a gap skips a step and a block with neither dimension never ends.
- **Edge cases** — rounds are **flattened** by the LLM into a plain sequence (no `repeat` field), and `assembleProgram` renormalises `order` to `1..n` so a mis-numbered draft still persists correctly. An empty/absent `blocks` means a simple prescription driven by the `target*` fields.
- **Code** — [`program-validator.ts:58`](../../../../src/program/program-validator.ts#L58); [`program.helpers.ts:44`](../../../../src/program/program.helpers.ts#L44)

### `PROGRAM-7` — the backend assigns every id and forces `type: 'static'`

- **Effect** — the LLM returns no `programId`, `prescriptionId`, `revisionId`, or `type`; `assembleProgram` generates them and sets `static`, `currentRevision: 1`.
- **Why** — ids are DB identity, not model output.
- **Code** — [`program.helpers.ts:14`](../../../../src/program/program.helpers.ts#L14) — `assembleProgram`

### `PROGRAM-8` — persistence is one transaction, and archives the previous program

- **Effect** — the old active program is archived, then Program → Revision → PlannedSession → Prescription → PrescriptionBlock are written in one transaction (blocks last, being a child table).
- **Edge cases** — one active static program per user is an invariant maintained by the archive step.
- **Code** — [`program.service.ts:205`](../../../../src/program/program.service.ts#L205) — `persist`

### `PROGRAM-9` — the pool sent to the LLM is deliberately slim

- **Effect** — `pool-retrieval.ts` sends `~2K tokens`: id, name, pattern, muscles, goal fit, equipment, difficulty, type. **No** instructions, cues or media.
- **Why** — cost, and those fields are display-only — the model does not need them to choose a movement.
- **Code** — [`pool-retrieval.ts`](../../../../src/program/pool-retrieval.ts)

### `PROGRAM-10` — nutrition is code, derived, and not persisted

- **Trigger** — either program endpoint (`generate`, `active`) shaping its response.
- **Effect** — `computeNutrition(profile)` returns a `{calorieLow, calorieHigh, proteinLow, proteinHigh, intent}` target (Mifflin–St Jeor, `ACTIVITY_FACTOR` 1.45, +350 kcal surplus when BMI < 18.5), attached to `Program.nutrition`. It is **never** stored — it is re-derived from the profile each response.
- **Edge cases** — incomplete body data (missing sex/age/height/weight) returns `null`; the client hides the nutrition card rather than showing invented numbers.
- **Why** — the LLM must not produce calorie targets (core invariant), and the client must not either (mobile `API-3`). One deterministic source. `NUTRITION_RULE_VERSION` records the formula version.
- **Code** — [`nutrition.ts`](../../../../src/program/nutrition.ts); attached in [`program.service.ts`](../../../../src/program/program.service.ts) — `generateStaticProgram`, `getActive`

### `PROGRAM-12` — the program has a duration, and sessions must cover every week of it

- **Trigger** — validation of the draft.
- **Effect** — the LLM outputs `durationWeeks`; the validator rejects it outside `[MIN_PROGRAM_WEEKS=2, MAX_PROGRAM_WEEKS=24]` (`DURATION_OUT_OF_RANGE`), and rejects a session set that does not cover **exactly** weeks `1..durationWeeks` — any missing or out-of-range `weekNumber` is `WEEK_COVERAGE_MISMATCH`.
- **Why** — a program with no declared length can't be placed on a calendar, and a gap week would leave the user with a day the plan can't answer. Duration is the LLM's call (goal-dependent) but the range and full coverage are code's.
- **Edge cases** — the range check short-circuits coverage: a below-min duration reports only `DURATION_OUT_OF_RANGE`. `durationWeeks` is persisted on `Program`.
- **Code** — [`program-validator.ts:32`](../../../../src/program/program-validator.ts#L32) (the `0)` block); [`program-draft.schema.ts`](../../../../src/llm/schemas/program-draft.schema.ts)

### `PROGRAM-13` — a calendar day resolves to the current session deterministically, no row per day

- **Trigger** — `GET /program/current?date=YYYY-MM-DD` (date optional, defaults to today UTC; a malformed date is a 400).
- **Effect** — `resolveDate` maps the date to `training | rest | before_start | program_complete` from `startDate` + `trainingDays` + `durationWeeks`; `getCurrent` adds `no_program` when there is no active program. `training` returns the `PlannedSession` at the resolved `(weekNumber, dayNumber)` in `session`, hydrated with exercise names/blocks (same shape as `getActive`). **Every** non-`no_program` response also carries `nextSession` (a `SessionPointer`: the first planned day in week/day order with no completed session — the same next-day as `DASHBOARD-4`) and `programRevisionId`, so a **rest day is still actionable**: the client can start the next session immediately rather than being forced to wait.
- **Why** — `PlannedSession` has only `weekNumber`/`dayNumber`, no date. `trainingDays` (ISO weekday `1..7`, Mon=1, sorted; its 1-based index **is** `dayNumber`) plus `startDate` is the whole bridge to the real calendar — computed, never materialised as one row per day. `nextSession` is bundled so the mobile hero (user-centric) never dead-ends on a rest day.
- **Edge cases** — `startDate` and `trainingDays` are **code-assigned** at generate (start = today, weekdays = `trainingDaysFromProfile` from `preferredDays`/`daysPerWeek`), never the LLM. `trainingDays` empty ⇒ every in-range day is `rest` (but `nextSession` may still exist). A resolved training day with no matching `PlannedSession` row (should not happen — `WEEK_COVERAGE_MISMATCH` guards it) degrades to `rest`, never an empty session. `nextSession` is null once every planned day is logged.
- **Code** — [`calendar.ts`](../../../../src/program/calendar.ts); [`program.service.ts`](../../../../src/program/program.service.ts) — `getCurrent`; [`program.helpers.ts`](../../../../src/program/program.helpers.ts) — `trainingDaysFromProfile`

### `PROGRAM-14` — whole-program progress is "X of M", M = durationWeeks × training-days-per-week

- **Trigger** — `GET /program/current` (and mirrored on `GET /dashboard`, see `DASHBOARD-7`).
- **Effect** — `progress = { completed, total }`. `total = totalPlannedSessions = durationWeeks × trainingDays.length`. `completed` = distinct planned days backed by a `completed` `WorkoutSession` (ad-hoc logs with `plannedSessionId = null` do **not** count); the dashboard caps `completed` at `total`.
- **Why** — this is the absolute "how far through the whole plan am I" the reach-based `due`/`adherence` (`DASHBOARD-3`) deliberately does not answer.
- **Edge cases** — no active program ⇒ `{ completed: 0, total: 0 }`. Legacy rows with `trainingDays = []` ⇒ `total = 0`.
- **Code** — [`calendar.ts`](../../../../src/program/calendar.ts) — `totalPlannedSessions`; [`program.service.ts`](../../../../src/program/program.service.ts) — `getCurrent`

### `PROGRAM-11` — the program response carries exercise display names

- **Trigger** — both program endpoints returning prescriptions.
- **Effect** — each prescription includes `exerciseName` (and `exerciseSlug`) alongside `exerciseId`, so the client can render a movement without knowing the exercise catalogue.
- **Edge cases** — `Prescription` has **no** Prisma relation to `Exercise` (soft FK), so `getActive` resolves names with a **separate** `exercise.findMany` keyed by the revision's `exerciseId`s and stitches them in. `generate` fills `exerciseName` from the pool's `nameBySlug` map. A missing name falls back to the slug/id rather than an empty string breaking the UI.
- **Code** — [`program.service.ts`](../../../../src/program/program.service.ts) — `getActive`; [`program.helpers.ts:34`](../../../../src/program/program.helpers.ts#L34) — `assembleProgram`

---

## 4. State held

| Row | Tracks |
|---|---|
| `Program` | one active static program per user, `basedOnProfileVersion`, `durationWeeks`, `startDate`, `trainingDays` (ISO weekday `1..7`) |
| `ProgramRevision` | append-only; static = 1, living plans add more |
| `PlannedSession` | week/day/focus |
| `Prescription` | targets + `restSec` (+ `targetPaceSecPerKm` for cardio) |
| `PrescriptionBlock` | interval steps, unique on `(prescriptionId, order)` |

---

## 5. Dependencies

- **Memory** — [`profile`](../profile/profile.md) (policy + pool), [`session`](../session/session.md) (consumes prescriptions and blocks).
- **Services** — `LlmService.generateProgram` (structured output against `PROGRAM_DRAFT_SCHEMA`).

---

## 6. Known gotchas

- `PROGRAM_DRAFT_SCHEMA` runs in OpenAI **strict mode**: every property must appear in `required`. A field that does not apply is returned as `null`, never omitted — this is why `blocks` and `targetPaceSecPerKm` are nullable rather than optional.
- Schema drift has bitten this DB more than once. `Exercise.cues` was renamed to `instructions` and `contentMode`/`environments` were added in `schema.prisma` with **no migration**, so the live DB kept the old shape while the Prisma client selected columns that did not exist — `buildGuardrail`'s `exercise.findMany` failed with `column … does not exist`, which Prisma raises as a `PrismaClientKnownRequestError` and Nest emits as an **opaque 400** on `POST /program/generate`. Fixed by migrations `20260724000000_rename_cues_to_instructions` and `20260724000001_add_exercise_content_mode_environments`. If a "400 with no body" appears on any exercise-touching route, run `npx prisma migrate status` / `prisma validate` first — it is almost always a missing column, not a bad request.
- `reviseForSafety` copies prescriptions into a new revision; it does **not** yet copy their blocks. A safety revision of an interval session would lose the intervals.
- The validator keys the pool by **slug**, not uuid — that is what the LLM returns.
- An **upstream LLM failure** (bad `OPENAI_API_KEY`, rate limit, wrong model) is caught in `callStructured` and re-thrown as a `ServiceUnavailableException` (503) carrying the provider's real message. Before this it leaked the raw OpenAI error, which reached the client as an opaque 400 with no body. A 503 with `LLM provider lỗi: …` therefore means the key/model/quota, not the user's profile.

---

## 7. Change log

- `2026-07-23` — Claude — initial version: generate/validate/persist flow, pool constraint, volume + goal-conflict caps, interval blocks.
- `2026-07-24` — Claude — `PROGRAM-10` (server-computed nutrition, not persisted) and `PROGRAM-11` (prescriptions carry `exerciseName`/`exerciseSlug`); both endpoints now return the same enriched `Program` contract consumed by the mobile plan screen.
- `2026-07-24` — Claude — upstream LLM errors now surface as 503 with the provider's message instead of leaking as an opaque 400 (see gotchas).
- `2026-07-24` — Claude — fixed Exercise schema drift (migrations rename `cues`→`instructions`, add `contentMode`/`environments`) that was breaking `buildGuardrail` and thus every `POST /program/generate` with an opaque 400. Also applied the previously-pending `prescription_blocks` migration.
- `2026-07-24` — Claude — `PROGRAM-12`/`13`/`14`: programs now carry `durationWeeks` (LLM-chosen, validator-bounded `[2,24]`, full week coverage), `startDate` + `trainingDays` (code-derived), and a `calendar.ts` resolver behind `GET /program/current` that maps any date → a session / rest / complete plus `nextSession` (next unlogged day, so rest days stay startable) + `progress { completed, total }`. Migration `20260724010000_add_program_duration_calendar`. Peer: mobile `home`/`practice` memory (new `programProgress` on `/dashboard`, new `/program/current` contract).
