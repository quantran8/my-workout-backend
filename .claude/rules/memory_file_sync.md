# Memory File Sync Rule

**Whenever you modify a file in a way that changes the business logic or the flow of a feature, you MUST update that feature's memory file in the same change.** A code change that leaves the memory stale is a process violation — same severity as shipping a behaviour change with no test.

Memory files live in [.claude/memory/](../memory/). Read [.claude/memory/README.md](../memory/README.md) for their structure.

## Why this is strict

The memory file is read as a **spec**, not as documentation:

- An agent starting a task reads it as the working hypothesis about what the code does. If it lies, every decision downstream is built on the lie.
- Rules are numbered (`SESSION-4`, `PROFILE-2`) and cited from tests and from the *other repo's* memory files. A stale rule silently invalidates those citations.
- Much of what is recorded here cannot be recovered by reading one file — it is a cross-repo contract, a threshold whose rationale lives in another codebase, or a deliberate asymmetry that looks like a bug.

The cost of updating in the same change is a few minutes. The cost of drift compounds across every future change to that feature.

## When you MUST update

Update the memory file when your change:

- **Adds, removes, or changes a business rule** — a new validation, a new error branch, a different default.
- **Changes the flow** — reordering steps, adding a screen or request to a sequence, changing what happens when a step fails.
- **Changes a wire contract** — a field added to a request, an enum value renamed, a mapper's output changed. These are the highest-risk edits in this codebase: a client keeps compiling while silently sending the wrong vocabulary.
- **Changes user-visible behaviour tied to a documented rule** — navigation, an enabled-condition, a message, timing.
- **Moves or renames code** such that a `Code —` mapping line in the memory file now points at nothing.
- **Fixes a gotcha** the memory file flagged (remove it, don't leave it claiming a bug that is gone).

## When you do NOT need to update

- Formatting, whitespace, comments.
- Adding or removing imports.
- Renaming a private helper that the memory file does not name.
- Adding a test that asserts an already-documented rule.
- Localization swaps where behaviour is identical.

**When in doubt, update.** An over-documented rule costs a paragraph; a missing one costs an afternoon.

## How to update

1. Open `.claude/memory/features/<feature>/<feature>.md`. If the feature has no memory file yet and your change is non-trivial, create one from [TEMPLATE.md](../memory/TEMPLATE.md).
2. Find the numbered rule your change touches. **Edit it in place.** Do not append a new rule for a change to an existing one, and do not leave inline "(updated 2026-07-23: now does X)" notes — that turns a spec into a changelog.
3. If the rule no longer exists, retire it: keep the id, prefix the heading with `[RETIRED YYYY-MM-DD]`, and say in one line what replaced it. **Never renumber or reuse an id** — other files cite it.
4. Update the `Code —` mapping lines to the new paths.
5. Refresh `last_updated` in the header and append one line to the change log.
6. **If the change spans both repos** — a wire contract, the readiness gate, anything where the server enforces what the client collects — update the peer memory file in the same commit. The two are peers; a contract documented on one side only is half a contract.
7. Commit code + memory + tests together, in one commit, so a reviewer sees them side by side.

Pre-commit checklist for any change touching feature code:

- [ ] Memory file reflects the new behaviour
- [ ] `Code —` mappings point at real lines
- [ ] Peer repo's memory updated if the change crosses the API boundary
- [ ] `last_updated` and change log refreshed

## What NOT to do

- **Never** ship a code change that contradicts the memory file without updating it.
- **Never** defer the memory update to a follow-up PR. Code and memory land together or the memory is already wrong.
- **Never** rewrite a memory file from scratch to match new code. Preserve the numbered rules and their history; edit only what changed.
- **Never** treat the memory file as a place for task state, TODOs for yourself, or notes about the change you are making. It describes the product, not the work.
