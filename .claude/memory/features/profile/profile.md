# `profile` — business logic

| | |
|---|---|
| **unit** | `src/profile` |
| **kind** | `feature` |
| **status** | `live` |
| **last_updated** | `2026-07-23` |

**Source paths**

- [`profile.service.ts`](../../../../src/profile/profile.service.ts) — extract / save / read / guardrail
- [`flags.ts`](../../../../src/profile/flags.ts) — **deterministic** red flags + BMI
- [`guardrail.ts`](../../../../src/profile/guardrail.ts) — policy + filtered exercise pool
- [`adaptation-phase.ts`](../../../../src/profile/adaptation-phase.ts) — adaptation triggers, caps, state machine
- [`profile.types.ts`](../../../../src/profile/profile.types.ts) — the wire vocabulary

---

## 1. Purpose

Owns the user's constraints and goals, and turns them into the deterministic safety policy every generated program must obey.

---

## 2. Flow

```
POST /profile/extract   raw text → LLM draft → computeBmi + computeFlags (CODE) → draft + flags
PUT  /profile           client-edited profile → recompute flags/bmi → upsert UserProfile
                                                                    → append ProfileHistory (immutable)
GET  /profile           current profile + flags + bmi

buildGuardrail(profile)  → policy (what is allowed) + allowedPool (reviewed exercises minus blocked)
```

---

## 3. Business logic

### `PROFILE-1` — the LLM extracts, code decides

- **Trigger** — `POST /profile/extract`.
- **Effect** — the LLM produces a structured draft from free text. BMI and red flags are then computed by [`flags.ts`](../../../../src/profile/flags.ts) and overwrite anything the model produced.
- **Why** — the core invariant of this service. Safety verdicts must be reproducible and reviewable; an LLM is neither.
- **Code** — [`profile.service.ts:28`](../../../../src/profile/profile.service.ts#L28) — `extractProfile`

### `PROFILE-2` — client-supplied `bmi` and `redFlags` are always overwritten

- **Trigger** — `PUT /profile`.
- **Effect** — `computeFlags` runs on the submitted profile; the results replace whatever arrived.
- **Why** — a client could otherwise suppress a medical-referral flag by sending its own.
- **Code** — [`profile.service.ts:49`](../../../../src/profile/profile.service.ts#L49) — `saveProfile`

### `PROFILE-3` — red flags are policy actions, not numbers

- **Effect** — each flag carries `code`, `severity` and a list of **actions** (`MEDICAL_REFERRAL`, `NO_CALORIE_DEFICIT`, `CONSERVATIVE_START`, `BLOCK_EXERCISE_AREA`, `VOLUME_CAP`, `REQUIRE_GUARDIAN`, `RESOLVE_GOAL_CONFLICT`).
- **Thresholds** — BMI: `<16` severe-low (high), `<18.5` low (medium), `≥40` very-high (high), `≥30` high (low). Age: `<18` minor (guardian required), `≥60` older adult. Experience `beginner` → volume cap 10 sets/muscle/week. Any injury not explicitly `active: false` → block that area.
- **Why** — WHO international cut-offs. Safety always errs toward referral and a conservative start.
- **Edge cases** — `computeFlags` does **not** mutate the profile; BMI is returned separately.
- **Code** — [`flags.ts:19`](../../../../src/profile/flags.ts#L19) — `computeFlags`

### `PROFILE-4` — a goal conflict is detected and resolved by phasing, not refusal

- **Condition** — BMI `< 18.5` **and** the inferred needs contain endurance alongside gain/hypertrophy/strength.
- **Effect** — flag `GOAL_CONFLICT_GAIN_VS_ENDURANCE` with `RESOLVE_GOAL_CONFLICT`, and a suggested order: strength/hypertrophy first, endurance second.
- **Edge cases** — the validator then requires a `phasePlan` and caps cardio at 2 sessions/week (`PROGRAM-4`).
- **Code** — [`flags.ts:91`](../../../../src/profile/flags.ts#L91)

### `PROFILE-5` — the exercise pool only ever contains PT-reviewed movements

- **Effect** — `buildGuardrail` loads exercises `where reviewedBy != null`, then removes those contraindicated for the user's injury areas.
- **Why** — an unreviewed exercise has heuristic (LLM-derived) safety fields; it must never reach a user.
- **Edge cases** — the same `reviewedBy != null` condition gates `GET /exercises` and the execution-snapshot join, so all three surfaces agree.
- **Code** — [`profile.service.ts:123`](../../../../src/profile/profile.service.ts#L123) — `buildGuardrail`

### `PROFILE-6` — recent activity and detraining are independent of experience

- **Effect** — `recentActivityLevel === 'very_low'` **or** `detrainingDurationWeeks >= 12` each trigger an adaptation phase on their own, regardless of `experienceLevel`.
- **Thresholds** — `LONG_DETRAINING_WEEKS = 12`. Caps: strict (long detraining or a prior bad reaction) = 50% volume / difficulty 2 / low impact; standard = 60% / difficulty 3 / low impact.
- **Why** — §1.2 forbids merging them: skill does not survive a year off. This is what the mobile app's banded "last trained" question feeds (`ONB-5` there).
- **Edge cases** — an adaptation phase exits after 3 consecutive tolerated sessions.
- **Code** — [`adaptation-phase.ts:56`](../../../../src/profile/adaptation-phase.ts#L56) — `detectAdaptationTriggers`

### `PROFILE-7` — every save appends an immutable history snapshot

- **Trigger** — `PUT /profile`.
- **Effect** — `profileVersion` increments and a full snapshot (constraint, target, flags, bmi) is appended to `ProfileHistory` in the same transaction.
- **Why** — answers "which profile was this program built from?" — programs record `basedOnProfileVersion`.
- **Code** — [`profile.service.ts:65`](../../../../src/profile/profile.service.ts#L65)

---

## 4. State held

| Row | Tracks |
|---|---|
| `UserProfile` | current constraint/target/redFlags/bmi + `profileVersion` |
| `ProfileHistory` | append-only snapshot per version, unique on `(userId, profileVersion)` |
| `AdaptationPhase` | active/exited phase with its caps |

---

## 5. Dependencies

- **Memory** — [`program`](../program/program.md) (consumes policy + pool), [`session`](../session/session.md) (readiness reuses injury vocabulary).
- **Cross-repo** — [mobile onboarding memory](../../../../../mobile/.claude/memory/features/onboarding/onboarding.md).

---

## 6. Known gotchas

- `UpdateProfileDto.constraint` is typed `@IsObject()` only — **no per-field validation**. A wrong enum value is stored and then silently ignored by `flags.ts`, which compares `injuries[].area` by equality. This is why the mobile mapper is tested against literal wire strings; see `API-1` there.
- `computeFlags` is pure and side-effect free; callers assign `bmi` themselves.
- `Injury.active` is the legacy field; `status` (`active` / `recovering` / `historical`) is preferred, and `active !== false` is what actually blocks an area.

---

## 7. Change log

- `2026-07-23` — Claude — initial version: extract/save flow, deterministic flags, guardrail pool, adaptation triggers.
