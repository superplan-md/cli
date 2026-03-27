# 00 - GLOBAL RULE: Superplan Operating Contract

As an AI agent working in this repository, this file is the fallback contract.
Read it first. Follow it even if you misread or skip the full skill chain.

## 1. Mandatory First Contact

Before implementation, broad repo exploration, repo-specific planning, or repo-specific clarification:

- load and follow `superplan-entry`
- do not jump straight to `superplan status --json`, `superplan run --json`, or task authoring before `superplan-entry` decides Superplan is actually needed
- do not scaffold tracked work before `superplan-entry` has decided that Superplan should engage

## 2. `superplan-entry` Owns The Engagement Decision

`superplan-entry` decides:

- whether Superplan should stay out
- whether the repo is ready enough to proceed
- whether missing repo init should be created now
- which workflow phase owns the next step

If `superplan-entry` says stay out:

- answer directly
- create no Superplan artifacts
- do not force the user through `init`, task creation, or lifecycle commands

## 3. Task Creation Before Acting

Once Superplan is engaged, task creation is how users see what the agent is doing. It is not ceremony.

**The rule:** Any repo work that touches files or runs commands requires a tracked Superplan task before acting.

**The only exception — one-file/no-decisions carve-out:** A single-file edit that requires no decisions and is verifiable by inspection (e.g. fix a typo, bump a version number) may skip task creation entirely. This carve-out is narrow. If there is any doubt about whether a decision is involved, create a task.

**The multi-step rule:** Work with 3 or more distinct steps requires a complete task graph before execution begins. Do not start executing multi-step work from a single task or no task.

Rationalizations that mean stop and create a task first:

- "This is just a small fix."
- "I'll create the task after."
- "It's only two steps."
- "The user just wants the code."
- "This doesn't need structure."

## 4. Fastest Path For Missing Repo Init

Missing repo init is not a blocker by itself.

If the `superplan` CLI is available and the repo should use Superplan:

- run `superplan init --scope local --yes --json`
- continue in the same turn
- avoid turning repo init into a separate user chore unless the CLI itself is missing or the command fails

Prefer the fewest user-visible steps that preserve correct workflow state.

## 5. CLI Discipline After Engagement

Once `superplan-entry` has decided Superplan should engage:

- use the Superplan CLI as the control plane
- do not hand-edit `.superplan/runtime/`
- do not hand-create `tasks/T-xxx.md` task contracts
- author the root graph in `.superplan/changes/<change-slug>/tasks.md` only in the shaping phase that owns that work
- use `superplan run`, `superplan task runtime block`, `superplan task runtime request-feedback`, `superplan task review complete`, and related lifecycle commands only after engagement is already settled

## 6. Overlay And User Communication

- do not assume overlay visibility unless the current workflow phase has verified it
- keep workflow routing internal
- talk to the user about outcomes, blockers, and decisions, not about skill selection or command choreography
