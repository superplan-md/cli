# 00 - GLOBAL RULE: Superplan Operating Contract

As an AI agent working in this repository, this file is the fallback contract.
Read it first. Follow it even if you misread or skip the full skill chain.

## 1. Mandatory First Contact

Before implementation, broad repo exploration, repo-specific planning, or repo-specific clarification:

- load and follow `superplan-entry`
- if a specific phase skill is a plausible next owner, load it before improvising a custom workflow
- do not jump straight to `superplan status --json`, `superplan run --json`, or task authoring before `superplan-entry` decides Superplan is actually needed
- do not scaffold tracked work before `superplan-entry` has decided that Superplan should engage
- do not begin execution for newly requested repo work until routing has produced an explicit depth choice and shaping has produced an executable frontier

## 2. `superplan-entry` Owns The Engagement Decision

`superplan-entry` decides:

- whether Superplan should stay out
- whether the repo is ready enough to proceed
- whether missing repo init should be created now
- which workflow phase owns the next step
- whether the request must be routed upward because one task would hide visibility, verification, or delegation boundaries

If `superplan-entry` says stay out:

- answer directly
- create no Superplan artifacts
- do not force the user through `init`, task creation, or lifecycle commands

## 3. Task Creation Before Editing

Once Superplan is engaged, task creation is how users see what the agent is doing. It is not ceremony.

**The rule:** Read-only repo inspection, local reasoning, and user-facing planning may happen before task creation. The moment work will edit files, mutate repo state, or enter tracked execution, create or claim a tracked Superplan task first.

**The only exception — one-file/no-decisions carve-out:** A single-file edit that requires no decisions and is verifiable by inspection (e.g. fix a typo, bump a version number) may skip task creation entirely. This carve-out is narrow. If there is any doubt about whether a decision is involved, create a task.

**The multi-step rule:** Work with 3 or more distinct steps requires a complete task graph before execution begins. Do not start executing multi-step work from a single task or no task.

**The anti-collapse rule:** If the request has 3 or more distinct deliverables, surfaces, or verification concerns, or if parallelization would be useful, do not flatten it into a single task merely because one agent could execute it alone.

Rationalizations that mean stop and create a task first:

- "This is just a small fix."
- "I'll create the task after."
- "It's only two steps."
- "The user just wants the code."
- "This doesn't need structure."
- "I can hold this all in my head."
- "One agent can just do the whole thing."

## 4. Fastest Path For Missing Repo Init

Missing repo init is not a blocker by itself.

If the `superplan` CLI is available and the repo should use Superplan:

- run `superplan init --yes --json`
- continue in the same turn
- avoid turning repo init into a separate user chore unless the CLI itself is missing or the command fails

Prefer the fewest user-visible steps that preserve correct workflow state.

## 5. CLI Discipline After Engagement

Once `superplan-entry` has decided Superplan should engage:

- use the Superplan CLI as the control plane
- prefer `superplan run --json` or `superplan run <task_ref> --json` as the default execution entrypoint; use `superplan status --json` for frontier orientation, inspection, or recovery
- do not hand-edit `.superplan/runtime/`
- do not hand-create anything under `.superplan/`
- route plans, specs, graph tasks, task contracts, and workspace logs through the CLI so placement stays correct
- use `superplan run`, `superplan task runtime block`, `superplan task runtime request-feedback`, `superplan task review complete`, and related lifecycle commands only after engagement is already settled

## 6. Overlay And User Communication

- do not assume overlay visibility unless the current workflow phase has verified it
- `control-plane mode`: use for entry, route, shape, execute, review, and normal lifecycle handling; be terse, outcome-focused, and do not narrate skill or command choreography
- `planning mode`: use for plan, brainstorm, or any user-visible approach decision; explain approaches, recommendation, trade-offs, and execution path in project terms
- do not blend the modes accidentally: control-plane work stays quiet, planning work makes the useful reasoning visible
- talk to the user about outcomes, blockers, and decisions, not about skill selection or command choreography
- every substantial update should say what actual work was done, what verification is being run and for what risk, and what decision or blocker matters now

## 7. Skill Trigger Discipline

- skill descriptions are activation signals, not mini-summaries of workflow steps
- frontmatter descriptions should describe when to load the skill, using concrete triggers, symptoms, and situations
- do not hide the real trigger behind vague phrases like "when needed" or "for planning"
- once a specific phase skill clearly applies, prefer that local rule over keeping work under a broad umbrella skill
