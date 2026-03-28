---
name: superplan-entry
description: Use when a new request might involve repo work, tracked changes, workspace-specific decisions, or durable coordination and you must decide whether Superplan should engage before exploring or implementing.
---

# Using Superplan

## Overview

Universal outer workflow layer for Superplan.
Internal category: `workflow-control` / `execution-orchestration`.

This skill replaces the entry discipline that `using-superpowers` used to provide.

Keep it small, but not permissive.
Its job is to decide whether Superplan should meaningfully participate, whether readiness is missing, and which workflow phase owns the next responsibility.

If there is a meaningful chance that the request is repo work, use this skill before implementation, broad repo exploration, or clarifying questions.

## Fast Trigger Rule

Treat this as an early trigger, not a late fallback.

- if there is even a modest chance the request is repo work, load this skill first
- do not wait for "proof" that the work is complex before routing
- do not keep the work inside `superplan-entry` once a narrower phase owner is clear

The value of this skill is early discrimination, not broad control.

## Subagent Guard

If you were dispatched as a bounded subagent to execute, investigate, or verify a specific task, skip this skill.

Do not rerun top-level Superplan entry routing from inside a task-owned subagent unless the assignment explicitly says to reevaluate engagement.

## Instruction Priority

Follow this order:

1. direct user instructions and repo instructions such as `AGENTS.md`, `CLAUDE.md`, or equivalent host guidance
2. `superplan-entry` entry discipline
3. generic default behavior

If a repo instruction conflicts with a default Superplan habit, obey the user or repo instruction.

## Mandatory Discipline

Treat entry routing as mandatory first-contact discipline, not optional advice.

- do not start implementing first and promise to structure later
- do not start broad repo exploration first and claim routing can happen after
- do not ask clarifying questions first when the real first question is whether Superplan should engage
- do not rationalize that a dense request is "probably just one task" without checking
- do not let "smallest useful depth" become a reason to skip an explicit route result
- do not begin execution for newly requested repo work until the route and shape chain is complete

Rationalizations that mean stop and use this skill:

- "This is probably straightforward."
- "I'll inspect a few files first."
- "I'll just ask one clarifying question."
- "I already know this repo."
- "The user asked for code, not process."
- "The skill description is broad, so I can skip it."
- "I'll know whether this is repo work after a quick look."
- "This probably stays lightweight, so routing can wait."

When repo work is in play, entry discipline outranks generic default behavior unless the user or repo explicitly says otherwise.

## Workspace Precedence

Inspect the repo first before suggesting generic Superplan helpers.

Prefer the workspace's current harnesses, scripts, custom skills, and repo-native workflows when they already provide a better path.

Use Superplan to coordinate and supervise that setup, not to replace it.

Do not modify or outrank a working user-owned workflow unless the user explicitly asks.

## User Communication

Keep workflow control language internal.

- do not narrate skill selection, routing decisions, phase names, or command-by-command orchestration to the user
- do not send meta progress updates such as "I'm using `superplan-entry`", "I'm shaping the change now", or activity logs like "Explored 5 files"
- progress updates should focus on user-visible value: what is being changed, what risk is being checked, what decision matters, or what blocker affects the user
- mention a command, artifact, or workflow phase only when it directly explains a user-facing decision, blocker, or requested detail
- when in doubt, prefer project thoughts over process thoughts

## CLI Discipline

Entry routing is not permission to explore the CLI surface.

- once the current intent is known, use the canonical command path already named in this skill
- do not call `--help`, neighboring subcommands, or diagnostic commands just to orient yourself when the correct command is already listed
- use `superplan task inspect show <task_ref> --json` only when one task's detailed readiness is actually needed
- use `superplan doctor --json` only for setup or install uncertainty, not normal routing
- once the needed CLI state is known, stop polling and route or act

## Trigger

Use when:

- Superplan is installed or expected in the current host environment
- the request may involve meaningful repo work
- the user asks for structured work, execution help, tracking, visibility, or durable context
- the system must decide whether Superplan adds value before deeper workflow work begins
- the request may refer to already shaped work that should resume or be reviewed rather than routed from scratch

In practice, this is the default entry layer for repo work in this host.

For dense requirement dumps, packed queries, JTBD lists, or multi-constraint briefs, assume this skill applies unless there is a strong reason to stay out.
For new repo work with open structure, execution cannot begin until `superplan-route` has produced an explicit depth decision and `superplan-shape` has produced the initial executable frontier.

## Specific-Owner Rule

As soon as the next owning phase is clear, hand off.

- use `superplan-route` for engagement and depth decisions
- use `superplan-context` when missing durable context is the real blocker
- use `superplan-review` when completion authority is the real need
- use `superplan-execute` when tracked work already exists and the question is how to move it

Do not let `superplan-entry` become a long-lived umbrella once the specific next owner is obvious.

## Stay Out

Stay conversational and skip task creation entirely when:

- the user wants a simple explanation or answer
- no durable artifact would help
- no visibility or supervision value would be created
- no reusable context would be captured
- the request is casual, ephemeral, or already fully satisfied
- the work touches exactly one file and requires no decisions — a single-file edit that is verifiable by inspection (e.g. fix a typo, bump a version number) is the only repo-work exception to the task creation mandate

The one-file/no-decisions carve-out is narrow and intentional. If there is any doubt about whether a decision is involved, assume task creation is required.

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
- some hosts only provide skill discovery rather than true startup bootstrap, so this skill must be triggerable from natural repo-work requests
- agents should not need to choose between multiple overlapping commands for the same intent
- entry routing should usually resolve without CLI command-surface exploration
- Superplan should improve the workflow, not hijack it

## Allowed Actions

- inspect the repo briefly for readiness and context
- inspect repo-native workflows, scripts, harnesses, and custom skills before suggesting generic Superplan helpers
- inspect whether work is already shaped and should resume in a later phase
- decide whether to stay out or continue
- run the minimum readiness command needed to make engagement possible
- route to `superplan-route`
- route to `superplan-context` when missing context is the real blocker
- route to `superplan-execute` when tracked work is already shaped and should move forward
- route to `superplan-review` when the real request is completion authority
- run repo-local init automatically when the CLI exists and Superplan engagement is warranted
- give brief readiness guidance only when the CLI itself is missing or a required readiness command fails

## Current CLI Loop

When Superplan is active in a repo, prefer the CLI as the execution control plane.

Common commands:

- `superplan context bootstrap --json` to create missing durable workspace context entrypoints
- `superplan context status --json` to inspect missing durable workspace context entrypoints
- `superplan change new <change-slug> --json` to create one tracked change root
- `superplan change plan set <change-slug> --stdin --json` to write change-scoped plan content
- `superplan change spec set <change-slug> --name <spec-slug> --stdin --json` to write change-scoped spec content
- `superplan change task add <change-slug> --title "..." --json` to add tracked work without manual graph editing
- `superplan context doc set <doc-slug> --stdin --json` to write durable context docs
- `superplan context log add --kind <decision|gotcha> --content "..." --json` to append workspace log entries
- `superplan validate <change-slug> --json` to validate `tasks.md` graph structure and task-contract consistency
- `superplan task scaffold new <change-slug> --task-id <task_id> --json` to scaffold exactly one graph-declared task contract
- `superplan task scaffold batch <change-slug> --stdin --json` to create two or more new task contracts in one pass
- `superplan status --json` to see active, ready, blocked, and needs-feedback tasks
- `superplan run --json` to claim the next ready task or continue the active task, with the chosen task contract and selection reason in the payload
- `superplan run <task_ref> --json` to explicitly start or resume one known task
- `superplan task inspect show <task_ref> --json` to inspect one task and its readiness reasons directly
- `superplan task runtime block <task_ref> --reason "<reason>" --json` when execution cannot safely continue
- `superplan task runtime request-feedback <task_ref> --message "<message>" --json` when the user must respond
- `superplan task review complete <task_ref> --json` after the work and acceptance criteria are satisfied
- `superplan task repair fix --json` when runtime state becomes inconsistent
- `superplan doctor --json` to verify setup, overlay launchability, and workspace health when readiness is unclear
- `superplan overlay ensure --json` to explicitly reveal or resync the overlay when overlay support is enabled
- `superplan overlay hide --json` to close the overlay when the workspace is idle or empty
- when shaping tracked work, route all `.superplan/` writes through CLI commands instead of editing files directly

Execution default:

1. check `superplan status --json`
2. claim work with `superplan run --json`
3. do not edit repo files until `superplan run --json` or `superplan run <task_ref> --json` has returned an active task for this turn
4. treat the returned active-task context as the edit gate; if no active task context was returned, implementation does not begin
5. use the task returned by `superplan run`; only call `superplan task inspect show <task_ref> --json` when you need one task's full details and readiness reasons
6. if `run`, `status`, or task activation returns an unexpected lifecycle or runtime error, the next action must be another Superplan command, not code edits
7. execute through the workflow spine, especially `superplan-execute`, instead of ad hoc task mutation
8. block, request feedback, repair, reopen, or complete through the runtime commands rather than editing markdown state by hand
9. if overlay support is enabled for the workspace and a launchable companion is installed, expect `superplan task scaffold new`, `superplan task scaffold batch`, `superplan run`, `superplan run <task_ref>`, and `superplan task review reopen` to auto-reveal the overlay when work becomes visible; on a fresh machine or after install/update, verify overlay health with `superplan doctor --json` and `superplan overlay ensure --json` before assuming it is working, and inspect launchability or companion errors if the reveal fails; use `superplan overlay hide --json` when the workspace becomes idle again
10. after overlay-triggering commands, inspect the returned overlay payload; if `overlay.companion.launched` is false, surface `overlay.companion.reason` instead of assuming the overlay appeared

Authoring default:

1. create the tracked change once with `superplan change new <change-slug> --json`
2. do not edit files under `.superplan/` directly when the CLI can own the write
3. use `superplan change new --single-task` for the fastest tracked one-task path
4. use `superplan change task add` to define additional tracked work and let the CLI place graph and task-contract artifacts correctly
5. use `superplan change plan set` and `superplan change spec set` for change-scoped plan/spec truth
6. use `superplan context doc set` and `superplan context log add` for workspace-owned memory
7. when the request is large, ambiguous, or multi-workstream, do not jump straight into task creation; route through clarification, spec, or plan work first, then define tracked tasks through the CLI
8. prefer stdin over ad hoc temp files in agent flows
9. use the returned task payloads directly after CLI authoring instead of immediately calling `superplan task inspect show`

Canonical command rule:

- prefer the one obvious command for the current intent
- do not choose between multiple overlapping commands when one canonical path exists
- do not explore neighboring CLI commands when one canonical path is already listed here
- do not call `--help` or diagnostic commands just to confirm a command the skill already named
- do not replace canonical task authoring with shell loops or direct file rewrites
- prefer commands that already return the needed task payload instead of making extra follow-up calls

Initialization rule:

- do not call `superplan change new`, `superplan task scaffold new`, `superplan task scaffold batch`, or any other scaffolding command until `superplan-entry` has decided Superplan should engage
- if Superplan should engage and repo init is missing while the CLI exists, run `superplan init --yes --json` immediately instead of stopping to tell the user to do it
- once repo init succeeds, continue to the owning workflow phase in the same turn

## Entry Decision Order

Apply this order:

1. respect direct user and repo instructions
2. honor the subagent guard and skip top-level routing inside bounded task subagents
3. stay out if Superplan adds no durable structure, visibility, or reusable context
4. inspect the repo's existing workflows and prefer them over new Superplan-specific helpers
5. check readiness layers: CLI availability, init, and context
6. if the request targets already shaped work, resume the owning workflow phase directly
7. if the request is new or the structure decision is still open, route to `superplan-route`
8. if routing chose engaged work for a new request, continue until `superplan-shape` has made the next executable frontier explicit

Do not bounce already shaped work back through `superplan-route` just because the current message is short.

Completion rule:

- if Superplan stays out, answer directly and stop
- if the CLI is missing, give the concrete missing-layer guidance and stop
- if repo init is missing but the CLI exists and Superplan should engage, run repo-local init and continue
- if a readiness command fails, surface the failure concretely and stop
- if the owning phase is already known, hand off directly in the same turn
- if the request is dense, packed, or structurally ambiguous, do not stop at "this should route"; continue until the owning next phase is explicit
- if `superplan-route` is invoked and returns `direct`, `task`, `slice`, or `program`, the work is not done until the route result is explicit and the next workflow owner is explicit, normally `superplan-shape`
- if the request is new and still structurally open, do not stop after routing; execution remains blocked until shaping has created an executable frontier

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
- do not end the turn with a vague recommendation to "use Superplan" when a specific owning phase is already knowable
- do not treat an internal hunch like a route result; the depth choice must be explicit enough for downstream shaping to consume

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
- stopping at a generic statement that Superplan should probably be used
- classifying a dense request as route-worthy but failing to hand off to the owning next phase
- bypassing the owning workflow phase just because a support skill feels relevant
- sending already shaped work back to `superplan-route` by reflex
- forcing engagement when Superplan adds no value
- acting on repo work without a tracked task when the one-file/no-decisions carve-out does not apply
- starting execution for work with 3 or more distinct steps without a complete task graph
- starting execution for new tracked work before `superplan-route` has produced an explicit depth choice and `superplan-shape` has produced a concrete executable frontier
- collapsing dense multi-surface work into one task just because a single agent could personally carry it
- using entry routing as cover for CLI command-surface exploration once the next workflow owner is already clear
- calling `--help`, neighboring subcommands, or repeated `status`/`task inspect show`/`doctor` checks without a concrete routing need

## Readiness Rules

- If the `superplan` CLI itself appears missing, give brief installation or availability guidance and stop.
- If the repo is not initialized and Superplan should engage, run `superplan init --yes --json` and continue.
- If host or agent integration appears missing but the CLI exists, do not let that block repo-local engagement by itself.
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
- repo-local init performed, then handoff to the owning next phase
- readiness guidance with the concrete missing layer called out when the CLI is missing or a readiness command fails
- installation or availability guidance for the `superplan` CLI
- route to `superplan-context`
- route to `superplan-route`
- route to `superplan-execute`
- route to `superplan-review`

The output should be brief and legible.

For packed or ambiguous repo-work, "brief" does not mean vague. The output must still make the owning next phase explicit.
For newly requested engaged work, the output is not complete unless the route result is explicit enough for shaping and the owning next phase is named.

## Handoff

Likely handoffs:

- `superplan-route`
- `superplan-context`
- `superplan-execute`
- `superplan-review`
- no further Superplan action

## CLI Hooks

- `superplan doctor --json`
- `superplan init --yes --json`
- `superplan change new <change-slug> --json`
- `superplan validate <change-slug> --json`
- `superplan task scaffold new <change-slug> --task-id <task_id> --json`
- `superplan task scaffold batch <change-slug> --stdin --json`
- `superplan status --json`
- `superplan run --json`
- `superplan parse --json`
- `superplan task inspect show <task_ref> --json`
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
- dense PRDs, implementation checklists, or multi-surface requirement dumps even when one agent could probably execute them alone

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

Hard escalation cases:

- if the request has 3 or more distinct deliverables, surfaces, or verification concerns, do not skip explicit routing
- if parallelization would be useful, do not let entry hand the work straight to execution as a single task
