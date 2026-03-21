---
name: superplan-entry
description: Default entry skill when Superplan is active in the current host or repo and the system must decide whether the request should stay conversational or enter structured Superplan workflow.
---

# Using Superplan

## Overview

Universal outer workflow layer for Superplan.
Internal category: `workflow-control` / `execution-orchestration`.

This skill replaces the entry discipline that `using-superpowers` used to provide.

Keep it small.
Its job is to decide whether Superplan should meaningfully participate, whether readiness is missing, and which workflow phase owns the next responsibility.

## Subagent Guard

If you were dispatched as a bounded subagent to execute, investigate, or verify a specific task, skip this skill.

Do not rerun top-level Superplan entry routing from inside a task-owned subagent unless the assignment explicitly says to reevaluate engagement.

## Instruction Priority

Follow this order:

1. direct user instructions and repo instructions such as `AGENTS.md`, `CLAUDE.md`, or equivalent host guidance
2. `superplan-entry` entry discipline
3. generic default behavior

If a repo instruction conflicts with a default Superplan habit, obey the user or repo instruction.

## Workspace Precedence

Inspect the repo only enough to choose the right workflow lane before suggesting generic Superplan helpers.

Prefer the workspace's current harnesses, scripts, custom skills, and repo-native workflows when they already provide a better path.

Use Superplan to coordinate and supervise that setup, not to replace it.

Do not modify or outrank a working user-owned workflow unless the user explicitly asks.

## Exploration Discipline

Entry routing is not permission for a repo tour.

- inspect only the minimal repo, runtime, or workflow surfaces needed to decide stay-out, readiness, resume, or route
- prefer existing `.superplan/` artifacts, top-level workflow docs, and the one relevant harness over broad source reading
- once the next workflow owner is clear, stop inspecting and hand off
- if the decision still needs broader repo understanding, route to `superplan-context` instead of continuing ad hoc exploration

## Trigger

Use when:

- Superplan is installed or expected in the current host environment
- the request may involve meaningful repo work
- the user asks for structured work, execution help, tracking, visibility, or durable context
- the system must decide whether Superplan adds value before deeper workflow work begins
- the request may refer to already shaped work that should resume or be reviewed rather than routed from scratch

In practice, this is the default entry layer in Superplan mode.

## Stay Out

Stay conversational when:

- the user wants a simple explanation or answer
- no durable artifact would help
- no visibility or supervision value would be created
- no reusable context would be captured
- the request is casual, ephemeral, or already fully satisfied

If Superplan stays out, answer directly and do not create workflow artifacts.

## Inputs And Assumptions

Inputs:

- user request
- current repository and working directory
- whether Superplan appears active in this repo or host
- whether setup, init, and durable context appear present
- whether `.superplan/` exists
- whether useful workspace context exists already
- whether existing task or runtime artifacts suggest the work is already in a later workflow phase

Assumptions:

- users should not need to think about which skill comes next
- host environments may auto-trigger this skill
- agents should not need to choose between multiple overlapping commands for the same intent
- entry routing should usually resolve with narrow inspection rather than open-ended repo exploration
- Superplan should improve the workflow, not hijack it

## Allowed Actions

- inspect the repo briefly and narrowly for readiness and context
- inspect only the repo-native workflows, scripts, harnesses, and custom skills that materially affect the routing decision
- inspect whether work is already shaped and should resume in a later phase without drifting into broad repo exploration
- decide whether to stay out or continue
- route to `superplan-route`
- route to `superplan-context` when missing context is the real blocker
- route to `superplan-execute` when tracked work is already shaped and should move forward
- route to `superplan-review` when the real request is completion authority
- give brief readiness guidance when setup or initialization is missing

## Current CLI Loop

When Superplan is active in a repo, prefer the CLI as the execution control plane.

Common commands:

- `superplan change new <change-slug> --json` to create one tracked change root
- `superplan task new <change-slug> --title "<title>" --json` to create exactly one new task contract
- `superplan task batch <change-slug> --stdin --json` to create two or more new task contracts in one pass
- `superplan status --json` to see active, ready, blocked, and needs-feedback tasks
- `superplan run --json` to claim the next ready task or continue the active task, with the chosen task contract and selection reason in the payload
- `superplan run <task_id> --json` to explicitly start or resume one known task
- `superplan task show <task_id> --json` to inspect one task and its readiness reasons directly
- `superplan task block <task_id> --reason "<reason>" --json` when execution cannot safely continue
- `superplan task request-feedback <task_id> --message "<message>" --json` when the user must respond
- `superplan task complete <task_id> --json` after the work and acceptance criteria are satisfied
- `superplan task fix --json` when runtime state becomes inconsistent
- `superplan doctor --json` to verify setup and overlay launchability on a fresh machine or after install/update
- `superplan overlay ensure --json` to explicitly reveal or resync the overlay when overlay support is enabled
- `superplan overlay hide --json` to close the overlay when the workspace is idle or empty
- when shaping tracked work, let the main graph breakdown live in `.superplan/changes/<slug>/tasks.md` first, then use `superplan task new` for one contract or `superplan task batch` for multiple contracts instead of hand-creating `tasks/T-xxx.md`

Execution default:

1. check `superplan status --json`
2. claim work with `superplan run --json`
3. use the task returned by `superplan run --json`; use `superplan run <task_id> --json` when one specific task should become active; only call `superplan task show <task_id> --json` when you need one task's full details and readiness reasons
4. execute through the workflow spine, especially `superplan-execute`, instead of ad hoc task mutation
5. block, request feedback, or complete through the runtime commands rather than editing markdown state by hand
6. if overlay support is enabled for the workspace, expect `superplan task new`, `superplan task batch`, `superplan run`, `superplan run <task_id>`, and `superplan task reopen` to auto-reveal the overlay when work becomes visible; on a fresh machine or after install/update, verify overlay health with `superplan doctor --json` and `superplan overlay ensure --json` before assuming it is working, and inspect launchability or companion errors if the reveal fails; use `superplan overlay hide --json` when the workspace becomes idle again

Authoring default:

1. create the tracked change once with `superplan change new <change-slug> --json`
2. manual creation of individual `tasks/T-xxx.md` files is off limits; agents should shape the graph and dependencies first, then use the CLI to mint task contracts
3. use `superplan task new <change-slug> --title "<title>" --json` only when exactly one task should be created now
4. use `superplan task batch <change-slug> --stdin --json` when two or more tasks are clear enough to create in one pass
5. when multiple tasks are ready together, prefer one batch call so the graph edges and batch-local dependencies are captured in one authoring step
6. prefer stdin over temporary files for batch task authoring in agent flows
7. use the returned task payloads directly after authoring instead of immediately calling `superplan task show`

Canonical command rule:

- prefer the one obvious command for the current intent
- do not choose between multiple overlapping commands when one canonical path exists
- prefer commands that already return the needed task payload instead of making extra follow-up calls

## Entry Decision Order

Apply this order:

1. respect direct user and repo instructions
2. honor the subagent guard and skip top-level routing inside bounded task subagents
3. stay out if Superplan adds no durable structure, visibility, or reusable context
4. inspect only the repo's existing workflows that materially affect the routing decision, and prefer them over new Superplan-specific helpers
5. check readiness layers: CLI availability, setup, init, and context
6. if the request targets already shaped work, resume the owning workflow phase directly
7. if the request is new or the structure decision is still open, route to `superplan-route`

Do not bounce already shaped work back through `superplan-route` just because the current message is short.

## Routing Model

Treat Superplan as a workflow spine with support disciplines underneath it.

Workflow skills:

- `superplan-route`
- `superplan-shape`
- `superplan-execute`
- `superplan-review`
- `superplan-context`

Support discipline skills:

- `superplan-brainstorm`
- `superplan-plan`
- `superplan-debug`
- `superplan-tdd`
- `superplan-verify`

Entry routing should go into the workflow spine first.
Support skills should normally be invoked by the owning workflow skill rather than chosen as the first route from here.

Examples:

- ambiguity in work definition routes toward the workflow path that will later invoke `superplan-brainstorm`
- execution trouble routes toward the workflow path that may invoke `superplan-debug`
- completion claims route toward the workflow path that may invoke `superplan-verify`

Process-first rule:

- choose the owning workflow phase first
- only then let that phase invoke the right support discipline

## Direct Resume Routes

Route directly to the owning phase when the work is already past entry routing:

- `superplan-execute` for "continue", "pick the next task", "resume T-003", or other already-shaped execution work
- `superplan-review` for "is this task actually done?", "can this unblock?", or evidence-review requests
- `superplan-context` when serious brownfield work is blocked by missing or stale durable context
- `superplan-route` when the engagement or depth choice is still unresolved

See `references/routing-boundaries.md`.

## Forbidden Behavior

- doing full planning here
- authoring `specs`, `plan.md`, or task artifacts here
- doing broad execution here
- reviewing completion here
- bypassing the owning workflow phase just because a support skill feels relevant
- sending already shaped work back to `superplan-route` by reflex
- forcing engagement when Superplan adds no value
- turning every request into tracked work
- using entry routing as cover for broad repo exploration once the next workflow owner is already clear
- reading unrelated implementation files before deciding whether to stay out, resume, or route

## Readiness Rules

- If the `superplan` CLI itself appears missing, give brief installation or availability guidance and stop.
- If the CLI exists but host or agent integration appears missing, guide `superplan setup` and stop.
- If the repo is not initialized, give readiness guidance for `superplan init --json` and stop.
- If the user starts from `superplan init --json` but setup is missing too, call out the shortcut order clearly: `superplan setup`, then `superplan init --json`.
- If the repo is initialized but serious brownfield context is missing or stale, route to `superplan-context`.
- If the request targets existing tracked work, resume the owning later phase instead of forcing a fresh routing pass.
- If the request is repo work but the structure decision is still open, route to `superplan-route`.
- If a process discipline is needed, route first to the workflow skill that owns that phase rather than bypassing the workflow spine.

See `references/entry-discipline.md`, `references/readiness.md`, `references/routing-boundaries.md`, and `references/setup-config.md`.

## Decision And Gotcha Rules

Use `.superplan/decisions.md` only for meaningful route or readiness decisions that future agents would need to understand later.

Do not write tiny entrypoint observations there.

If you discover a recurring trap in how entry routing goes wrong for this repo or host, record it in `.superplan/gotchas.md`.

See `references/gotchas.md` and `references/memory-and-measurement.md`.

## Outputs

One of:

- direct answer with Superplan staying out
- readiness guidance with the concrete missing layer called out
- installation or availability guidance for the `superplan` CLI
- `superplan setup` guidance
- `superplan init --json` guidance
- route to `superplan-context`
- route to `superplan-route`
- route to `superplan-execute`
- route to `superplan-review`

The output should be brief and legible.

## Handoff

Likely handoffs:

- `superplan-route`
- `superplan-context`
- `superplan-execute`
- `superplan-review`
- no further Superplan action

## CLI Hooks

- `superplan doctor --json`
- `superplan setup`
- `superplan init --json`
- `superplan change new <change-slug> --json`
- `superplan task new <change-slug> --title "<title>" --json`
- `superplan task batch <change-slug> --stdin --json`
- `superplan status --json`
- `superplan run --json`
- `superplan parse --json`
- `superplan task show <task_id> --json`
- `superplan overlay ensure --json`
- `superplan overlay hide --json`

## Validation Cases

Should trigger:

- "Implement this feature and keep the work organized."
- "Help me execute this refactor with structure."
- "I want to use Superplan in this repo."
- any repo work request in a host configured for Superplan
- "Continue the next ready task."
- "Is T-003 actually done?"

Should stay out:

- "What does this function do?"
- "Explain TypeScript generics."
- "Summarize this paragraph."
- casual conversation with no durable repo value

Should route directly to execution:

- "Continue T-003."
- "Pick the next ready task."
- "Resume the tracked work from where we left off."

Should route directly to completion review:

- "Review whether this task can be marked done."
- "Check whether the evidence really satisfies the AC."

Ambiguous:

- "Fix this tiny typo."
- "Can you look into this bug?" with no clear need for structure yet
- "Write a quick recommendation doc" where the doc itself may be the deliverable
