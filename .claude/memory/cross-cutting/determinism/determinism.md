# `determinism` — business logic

| | |
|---|---|
| **unit** | `cross-cutting` |
| **kind** | `cross-cutting` |
| **status** | `live` |
| **last_updated** | `2026-07-23` |

**Source paths**

- [`src/profile/flags.ts`](../../../../src/profile/flags.ts), [`guardrail.ts`](../../../../src/profile/guardrail.ts), [`adaptation-phase.ts`](../../../../src/profile/adaptation-phase.ts)
- [`src/session/readiness.ts`](../../../../src/session/readiness.ts), [`execution-snapshot.ts`](../../../../src/session/execution-snapshot.ts), [`pain-stop.ts`](../../../../src/session/pain-stop.ts), [`tolerance.ts`](../../../../src/session/tolerance.ts)
- [`src/program/program-validator.ts`](../../../../src/program/program-validator.ts)
- [`src/llm/`](../../../../src/llm/) — the only LLM boundary

---

## 1. Purpose

The single architectural invariant of this backend: **the LLM drafts, deterministic code decides.** This file records where that boundary sits and the conventions that keep it honest.

---

## 2. Flow

Not a sequence. This governs every module.

```
LLM may:      extract structure from free text
              draft a program from a constrained pool

LLM may NOT:  compute bmi / redFlags / readiness verdicts / tolerance
              choose an exercise outside allowedPool
              set any threshold
              assign any database id
```

---

## 3. Business logic

### `DET-1` — every safety verdict comes from a pure function

- **Effect** — `computeFlags`, `assessReadiness`, `buildExecutionSnapshot`, `applyPainStop`, `computeSessionFeedback`, `detectAdaptationTriggers` and `validateProgram` take plain inputs, call nothing external, and return a value. No Prisma, no LLM, no clock.
- **Why** — reproducible, unit-testable, and reviewable by a domain expert who does not read TypeScript. Every one of these files carries a `DETERMINISTIC. Không LLM.` header — keep it true.
- **Edge cases** — services orchestrate (Prisma + LLM); logic files stay pure. Do not "just add a lookup" inside one.
- **Code** — every file listed above

### `DET-2` — the LLM's output is validated, never trusted

- **Effect** — a program draft passes `validateProgram` against the pool and the policy before persistence. Violations re-prompt the model.
- **Why** — "trust but verify". The model is a drafting tool operating inside constraints the code owns.
- **Code** — [`program-validator.ts`](../../../../src/program/program-validator.ts)

### `DET-3` — client-supplied computed values are always overwritten

- **Effect** — `bmi`, `redFlags`, readiness verdicts, `inferredNeeds` are recomputed server-side; whatever arrived is discarded.
- **Why** — otherwise a client could suppress a medical-referral flag simply by sending its own.
- **Code** — [`profile.service.ts:49`](../../../../src/profile/profile.service.ts#L49)

### `DET-4` — thresholds are named literals at the top of their file, and versioned

- **Effect** — each rule module declares its constants (`LONG_DETRAINING_WEEKS = 12`, `UNKNOWN_CAP_PCT = 70`, `LOW_ENERGY_CAP_PCT = 60`, `MODERATE_CAP_PCT = 80`, `CARDIO_MINIMAL_MAX_SESSIONS = 2`, `EXIT_CONSECUTIVE_TOLERATED = 3`, WHO BMI cut-offs) and a `RULE_VERSION`.
- **Effect (versioning)** — `ruleVersion` is persisted with each verdict (`readiness/v4.0`, `execution/v4.0`, `adaptation/v4.0`). **Changing a threshold means bumping the version**, or stored verdicts become indistinguishable from ones produced under the new rules.
- **Edge cases** — nothing enforces the bump. It is a convention, which is exactly why it is recorded here.
- **Code** — the `const` block at the top of each rule file

### `DET-5` — safety errs toward the conservative branch

- **Effect** — unknown readiness → 70% cap, not full volume. No substitute available → skip, not a guess. Any injury not explicitly `active: false` → block the area. A detraining band maps to its **lower** bound.
- **Why** — the asymmetry is deliberate: under-training is recoverable, injury is not.
- **Code** — [`readiness.ts`](../../../../src/session/readiness.ts), [`execution-snapshot.ts`](../../../../src/session/execution-snapshot.ts), [`flags.ts`](../../../../src/profile/flags.ts)

### `DET-6` — only PT-reviewed exercises reach a user

- **Effect** — `reviewedBy != null` filters the guardrail pool, `GET /exercises`, and the execution-snapshot join.
- **Why** — unreviewed rows carry heuristic (LLM-derived) `movementPattern`, `goalFit` and `contraindications`. Adding a fourth read path means adding the same filter.
- **Code** — [`profile.service.ts:128`](../../../../src/profile/profile.service.ts#L128), [`exercise.service.ts`](../../../../src/exercise/exercise.service.ts), [`session.service.ts:421`](../../../../src/session/session.service.ts#L421)

---

## 4. Dependencies

- **Memory** — [`profile`](../../features/profile/profile.md), [`session`](../../features/session/session.md), [`program`](../../features/program/program.md).

---

## 5. Known gotchas

- Pure functions are tested directly (`src/**/__tests__/*.spec.ts`) with no mocks. If a new rule needs a mock, it is probably in the wrong layer.
- Reading a threshold from config or the database would break `DET-4`'s auditability — the value would no longer be visible in the file that uses it. Keep them as literals.

---

## 6. Change log

- `2026-07-23` — Claude — initial version: the LLM/code boundary, threshold + ruleVersion conventions, conservative-default rationale.
