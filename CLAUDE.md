# my-workout-backend — AI Fitness Coach (NestJS)

NestJS + Prisma + Supabase backend for the AI fitness coach. Serves the [mobile](../mobile/) Flutter client under the `api/v1` prefix.

## Business-logic memory — read this first

**[.claude/memory/](.claude/memory/) holds the business logic and flow of every feature.** Read the relevant `features/<feature>/<feature>.md` *before* changing a module, and treat its numbered rules as the working hypothesis about what the code does.

**[.claude/rules/memory_file_sync.md](.claude/rules/memory_file_sync.md) is mandatory:** if a change alters business logic or flow, the memory file is updated in the same commit. A code change that leaves the memory stale is a process violation.

Rules are numbered (`SESSION-1`, `PROFILE-3`) and cited from tests and from the mobile app's memory files — never renumber or reuse an id.

## The core invariant: safety logic is code, not the LLM

The LLM **drafts**; deterministic code **decides**. Keep it that way.

- [flags.ts](src/profile/flags.ts), [readiness.ts](src/session/readiness.ts), [adaptation-phase.ts](src/profile/adaptation-phase.ts), [guardrail.ts](src/profile/guardrail.ts), [program-validator.ts](src/program/program-validator.ts) are pure functions with no LLM call. They own every threshold and every safety verdict.
- The LLM's program draft is validated against the allowed pool and the guardrail policy before it is persisted. Anything violating them is rejected, not trusted.
- **Never** let the LLM produce `bmi`, `redFlags`, or a readiness verdict — those are recomputed server-side and client-supplied values are ignored.
- Thresholds are literals at the top of their file. **Bump the module's `ruleVersion`** (`readiness/v4.0`, `execution/v4.0`, `adaptation/v4.0`) whenever you change one — stored verdicts record which version produced them.

## Commands

```bash
npx tsc --noEmit -p tsconfig.json     # must be clean
npx jest
npx prisma validate                   # after touching schema.prisma
npx prisma generate                   # regenerate the client
npx prisma migrate dev                # create a migration
npm run start:dev
```

`prisma validate` needs `DATABASE_URL` and `DIRECT_URL` set; placeholders are fine for validation and codegen.

## Conventions

- **Prisma primary keys are `id`**, uuid v7 via `dbgenerated("uuid_generate_v7()")`. A model whose PK is named anything else breaks every relation pointing at it — `npx prisma validate` catches this, and a broken schema silently leaves a stale client behind, which surfaces as dozens of confusing `tsc` errors.
- **Schema and migration must agree.** A model added to `schema.prisma` without a migration exists for the type system and nowhere else.
- Wire enums are snake_case (`too_easy`, `pain_stop`, `lower_back`). DTOs pin them with `@IsIn([...])`. Adding a value means updating the DTO, the mobile mapper, and both memory files.
- New endpoints go behind `AuthGuard` unless there is a stated reason not to.
