# `.claude/memory/` — Business-Logic Memory

The persistent **business-logic memory** for this repo. It stores the "what should this do" for every feature and flow whose behaviour is non-trivial.

Each entry captures **two things**:

1. **The business logic** — the rules the unit owns, in plain language: trigger, condition, effect, edge cases. Written so a non-engineer can read it.
2. **The business-to-code mapping** — for each rule, the file and symbol where it lives *today*. So when a rule changes, you know exactly which code to touch — and when code changes, which rule to re-check.

This is the source of truth an agent reads at the start of any task touching the unit, and writes back to after a behaviour change.

---

## Why this folder exists

This backend's defining property is that **the safety-critical logic is deterministic code, not the LLM** — and that split is invisible from any single file:

- [flags.ts](../../src/profile/flags.ts), [readiness.ts](../../src/session/readiness.ts), [adaptation-phase.ts](../../src/profile/adaptation-phase.ts), [guardrail.ts](../../src/profile/guardrail.ts) are pure functions carrying WHO thresholds and policy decisions. The LLM only *drafts*; [program-validator.ts](../../src/program/program-validator.ts) then rejects anything violating the pool or the policy.
- Thresholds are bare literals (`LONG_DETRAINING_WEEKS = 12`, `UNKNOWN_CAP_PCT = 70`, BMI 16 / 18.5 / 30 / 40). Their *rationale* is nowhere in the code.
- Silent defaults matter enormously: a client that skips `POST /session/:id/readiness` gets a 70% volume cap, and nothing in the request says so.
- `ruleVersion` strings (`readiness/v4.0`, `execution/v4.0`, `adaptation/v4.0`) must be bumped when a threshold changes — a convention no compiler enforces.

**Rule of thumb:** if a bullet would take 300+ lines of reading (or a trip into the *other* repo) to rediscover, it belongs here. If `grep` finds it in seconds, it does not.

---

## What goes here (and what doesn't)

### ✅ Goes here

- **Business rules** — every trigger / condition / effect / edge case.
- **Flow** — the order of steps in a lifecycle, and what happens when one is skipped or repeated.
- **Thresholds and their rationale** — the number *and* why it is that number.
- **What is deterministic vs. LLM-generated** — and what the validator refuses to accept.
- **Cross-repo contracts** — the wire vocabulary clients must speak.
- **The code mapping** — for each rule, where it lives today.

### ❌ Does not go here

- File paths or function signatures on their own (those are in source).
- Project conventions, commands, environment (those are in [CLAUDE.md](../../CLAUDE.md)).
- Prisma schema shape (that is in [schema.prisma](../../prisma/schema.prisma)).
- In-flight task state (use a plan file or the PR description).

---

## Folder layout

One folder per unit; the live spec inside is `<unit>.md`.

```
.claude/memory/
├── README.md            # this file
├── TEMPLATE.md          # start any new memory file from this
├── features/
│   ├── auth/auth.md
│   ├── profile/profile.md
│   ├── program/program.md
│   └── session/session.md
└── cross-cutting/
    └── determinism/determinism.md   # what is code vs. LLM, and why
```

- The folder name matches the module directory under [src/](../../src/) where reasonable.
- `cross-cutting/` holds rules no single module owns.

---

## File format

Every file follows [TEMPLATE.md](TEMPLATE.md). Required sections, in order:

1. **Header** — `unit`, `kind`, `status`, `source_paths`, `last_updated`.
2. **Purpose** — one or two sentences.
3. **Flow** — the step sequence, when the unit spans more than one endpoint.
4. **Business logic** — the most important section. One numbered rule per entry, each with Trigger / Condition / Effect / Edge cases / Code mapping. Numbered (`SESSION-1`, `SESSION-2`, …) so tests and other memory files can cite them.
5. **State held** — persisted rows and what each tracks.
6. **Dependencies** — other memory files, services this unit talks to.
7. **Known gotchas** — hacks, dead branches, behaviour that looks like a bug but is not.
8. **Change log** — append-only `YYYY-MM-DD — who — what changed and why`.

Rules are numbered because they are the unit of citation. A test, a code comment, or a mobile memory file can say "enforces SESSION-4" and that is unambiguous.

---

## How it is used

**Starting a task that touches a unit:** read `<unit>.md` first. Treat its business-logic section as the working hypothesis, then verify against the source:

- Rule matches code → proceed on it.
- Rule drifted → the code is the truth; fix the memory as part of the change.
- Memory has a rule the code does not → either dead memory or a lost feature. Ask.

**Finishing a task:** if behaviour or mapping changed, update the file in the same commit. See [.claude/rules/memory_file_sync.md](../rules/memory_file_sync.md) — this is not optional.

**Finding a rule:** `grep -r "readiness" .claude/memory/` should find every place it is documented, in either repo.

---

## Relationship to the mobile app's memory

[mobile](../../../mobile/.claude/memory/) has the same structure. The two are peers, not copies:

- The backend file owns what the **server computes and enforces**.
- The mobile file owns what the **user sees and chooses**.
- Where a rule spans both (the readiness gate, the profile wire contract), each file states its own half and links to the other.

When a rule moves between them — logic pushed from client to server or back — both files change in the same PR.
