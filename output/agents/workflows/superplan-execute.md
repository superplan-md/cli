---
name: superplan-execute
description: Use when tracked work is already shaped and the next move is to execute, verify, block, or request feedback without replanning from scratch.
---

# Execute Task Graph

## Overview

Move graph-ready work forward without drifting into broad replanning or unnecessary CLI exploration.

This is the main execution control surface once work has been shaped.
It should behave more like a scheduler and control plane than a single linear worker.

Execution should be primarily subagent-driven:

- select ready work
- dispatch bounded worker tasks
- dispatch verification in parallel where safe
- collect evidence and runtime signals
- decide continue, block, ask, review, or re-shape

## Specific-Owner Rule

Once execution starts, prefer the narrowest execution sub-problem over broad workflow reconsideration.

- use `superplan-debug` when a failure blocks forward motion
- use `superplan-tdd` when a new behavior or bugfix can be expressed as a proof-first implementation step
- use `superplan-verify` when success claims are approaching faster than proof
- use `superplan-review` when the question becomes "is this task actually done?"

## Trigger

Use when:

- there is executable tracked work
- at least one task is graph-ready
- the next need is to operate inside the shaped work rather than redesign it
- the system can make progress by dispatching one or more bounded work units

## Stay Out

Do not run when:

- the system is still deciding whether Superplan should engage
- shaping has not happened yet
- context or bootstrap is the real missing prerequisite
- the graph is invalid enough that execution should stop and escalate

## Inputs And Assumptions

Inputs:

- current task graph
- task contracts
- runtime state if present
- relevant workspace context
- current ready or blocking status
- relevant user-owned harnesses, scripts, custom skills, and workflows
- recent decision log entries affecting execution
- known workspace or task gotchas

Assumptions:

- execution should operate on ready work, not constantly redesign the project
- not every execution issue is a reason to reshape the graph
- multiple ready tasks may be best handled by subagents in parallel
- implementation and verification can sometimes run in parallel, but only when their contracts and write surfaces make that safe
- trajectory will change during execution; the key question is whether the change is local, structural, or strategic
- execution should route into existing workspace workflows rather than trying to replace them
- execution should stop reading and act once the next edit, command, or blocker transition is clear

## Graph, Contract, And Runtime Rule

Keep these layers distinct:

- graph truth decides readiness and dependency state
- task-contract truth defines the bounded unit and its acceptance criteria
- runtime truth records what is in progress, blocked, waiting for feedback, or review-ready

Do not collapse execution into a flat task-file-only mindset.

See `references/runtime-state.md`.

## CLI Alignment Now

Align execution to the CLI that exists today.

Current CLI execution surface:

- `superplan task inspect show <task_ref> --json`
- `superplan run --json`
- `superplan run --fresh --json`
- `superplan run <task_ref> --json`
- `superplan task runtime block <task_ref> --reason <reason> --json`
- `superplan task runtime request-feedback <task_ref> --message <message> --json`
- `superplan task review complete <task_ref> --json`
- `superplan task repair fix --json`
- `superplan status --json`
- `superplan worktree ensure <change-slug> --json`
- `superplan worktree list --json`
- `superplan worktree detach <change-slug> --json`
- `superplan worktree prune --json`

Current CLI truth:

- readiness is computed from parsed task contracts plus runtime state
- runtime states currently include `in_progress`, `in_review`, `done`, `blocked`, and `needs_feedback`
- runtime files live under the shared project state root `~/.config/superplan/project-<name>-<hash>/runtime/`, which the CLI may render as `.superplan/runtime/...` from the repo root
- `superplan task inspect show <task_ref> --json` includes one task's computed readiness reasons
- `superplan status --json` is the current narrow runtime summary surface even though a persisted `.superplan/runtime/current.json`-style summary is still only a product target
- review handoff is now represented explicitly as `in_review`

Therefore:

- use CLI transitions instead of hand-editing execution state
- use `status --json` and `run --json` to inspect the frontier; use `task inspect show <task_ref> --json` only when one specific task needs deeper inspection
- keep approval decisions explicit through `complete`, `approve`, and `reopen`
- do not end an execution turn after successful implementation proof while the task lifecycle still says `pending` or `in_progress`; either move it through `complete` and the appropriate review state or explicitly report the blocker that prevented that transition

## CLI Discipline

Execution is not permission to wander across CLI commands.

- start from the current task contract, the `superplan run` payload, and one relevant verification path
- do not call `--help`, neighboring subcommands, or extra diagnostic commands when the next execution command is already known
- use `superplan task inspect show <task_ref> --json` only when one task's detailed readiness or reasons are actually needed
- use `superplan doctor --json` only for setup or install issues, not normal execution
- once you know the next command, edit, or blocker transition, stop probing the CLI and act

## User Communication

Execution updates must describe actual work performed, current verification, material risks, and user-impacting decisions. Do not narrate Superplan ceremony.

- This skill runs in `control-plane mode`.
- do not mention scheduler behavior, subagent dispatch, runtime transitions, command history, or other Superplan mechanics unless the user needs that fact to understand a blocker, risk, or decision
- reject updates that are primarily internal process commentary
- tell the user what changed in the workspace, what verification is being run and for what risk, what decision was made and why, or what concrete blocker needs user input
- do not let execution updates drift into planning-mode essays unless the user actually needs approach selection or trade-off review

## Lifecycle Semantics And Recovery

Use the CLI as the transition gate for runtime state.

- graph-blocked means dependencies are not yet satisfied
- runtime-blocked means real execution trouble encountered while already working
- `needs_feedback` means the task cannot proceed without a human decision
- `in_review` means implementation is complete enough for acceptance review and waiting on approval or reopen

## When to Mark Done vs Request Feedback

**Mark task done when:**
- Component built and tests pass
- Code written and verified working
- Routine implementation complete with proof
- All acceptance criteria satisfied with evidence
- No user decision required

**Request feedback only for genuine blockers:**
- Requirements unclear — need user decision on specific tradeoff
- Two valid approaches — which convention or path do you prefer?
- External dependency changed — need new credentials or config
- Conflicting patterns found — which codebase convention to follow?
- Unexpected technical constraint — need scope or approach adjustment
- User verification required before proceeding

Do not use `needs_feedback` for routine work completion. Completion with passing verification should transition through `review complete`, not feedback request.

- impossible transitions should fail hard
- invalid or stale task contracts should block safe forward motion
- do not recover by hand-editing runtime files or markdown execution state
- passing tests or successful verification do not count as enough closure by themselves; runtime truth must be updated before claiming the task is effectively finished

Recovery rules:

- safe idempotent reruns are acceptable where the CLI already supports them
- use `superplan task repair fix` for deterministic runtime repair
- use `superplan task repair reset <task_ref>` only as an explicit recovery action, not as the normal path

See `references/runtime-state.md` and `references/lifecycle-semantics.md`.

## Trajectory Change Model

Classify discovered changes into three buckets:

- local trajectory change: implementation details vary but the task contract still holds
- structural trajectory change: dependencies, task boundaries, or contract validity changed materially
- strategic trajectory change: user goals or top-level expectations changed

Authority:

- local: stay inside execution
- structural: pause affected work and route to `superplan-shape`
- strategic: stop broad execution and route upward to `superplan-route`

See `references/trajectory-changes.md`.

## Allowed Actions

- choose graph-ready work
- choose whether work should run:
  - serially
  - in parallel by branch
  - in parallel by worker/verifier split
- dispatch bounded subagents for ready work
- assign clear ownership for each subagent's task or write surface
- dispatch verification in parallel where safe and useful
- dispatch subagents through existing repo scripts, custom skills, or harnesses when those are the trusted path
- begin task execution
- inspect the frontier with `superplan status --json` and `superplan run --json`; use `superplan task inspect show <task_ref> --json` when one task needs full detail
- repair invalid runtime drift deterministically with `superplan task repair fix` when warranted
- surface blocked state
- surface needs-feedback state
- route toward review when work appears ready
- collect evidence from subagents and merge it into runtime understanding
- re-evaluate the current frontier after major task events
- classify trajectory changes as local, structural, or strategic
- invoke support disciplines for debugging, tests, and verification
- append meaningful execution decisions to durable decision memory
- append newly discovered traps to gotcha memory when likely to matter again

Recommended patterns:

- branch parallelism
- worker plus verifier
- blocker investigation
- review shadowing

See `references/subagent-dispatch.md`.

## Forbidden Behavior

- broad replanning by default
- reshaping the graph unless truly necessary
- hand-editing lifecycle state ad hoc
- claiming the current CLI has a persisted `review` runtime state
- claiming completion without review
- continuing blindly when blocked or feedback is clearly needed
- spawning subagents without bounded ownership
- parallelizing work that shares unstable assumptions or tight write conflicts
- letting subagents silently redefine the task graph
- treating major structural drift as a local execution detail
- verifying against stale task contracts after the trajectory has materially changed
- ignoring `status`, `run`, `task inspect show`, or `task repair fix` when runtime or readiness is unclear
- treating every discovered issue as a reason to reshape
- replacing a working user-owned harness with a Superplan-specific flow during execution
- rewriting or bypassing existing custom skills or scripts unless explicitly asked
- falling into read-only CLI exploration after the next execution step is already known
- repeatedly polling `status` or `task inspect show` without a concrete state, blocker, or handoff reason

## Outputs

Expected output categories:

- task started
- task in progress
- implementation work started
- verification started for a named risk
- blocked with reason
- needs feedback
- ready for AC review
- runtime repaired
- localized re-shape required
- strategic re-route required
- execution cannot continue safely

Runtime summary should keep legible:

- what is running now
- what is verifying now
- what is blocked
- what is waiting for the user
- what changed in the trajectory
- what can run next
- which user-relevant decisions changed execution

## Current CLI Loop

Use the runtime-aware CLI as the scheduler:

1. if continuing known work, start with `superplan run <task_ref> --json`; if the user starts unrelated work in the same chat, use `superplan run --fresh --json`; otherwise start with `superplan run --json`
2. use `superplan status --json` only when frontier orientation, inspection, or runtime recovery is actually needed
3. use the task returned by `superplan run`; only call `superplan task inspect show <task_ref> --json` when you need one task's full details and readiness reasons
4. if `run` or task activation returns `EXECUTION_ROOT_OCCUPIED` or `EXECUTION_ROOT_STALE`, repair or inspect execution-root routing with `superplan worktree ensure <change-slug> --json` or `superplan worktree list --json` before continuing in the wrong checkout
5. `superplan task runtime block <task_ref> --reason "<reason>" --json` when blocked
6. `superplan task runtime request-feedback <task_ref> --message "<message>" --json` when user input is required
7. `superplan task review complete <task_ref> --json` only after the task contract is actually satisfied
8. `superplan task repair fix --json` if runtime state becomes inconsistent
9. if overlay support is enabled for the workspace and a launchable companion is installed, expect `superplan task scaffold new`, `superplan task scaffold batch`, `superplan run`, `superplan run <task_ref>`, and `superplan task review reopen` to auto-reveal the overlay as work becomes visible; on a fresh machine or after install/update, verify overlay health with `superplan doctor --json` and `superplan overlay ensure --json` before assuming it is working, and inspect launchability or companion errors if the reveal fails; use `superplan overlay hide --json` when the workspace becomes idle or empty
10. after overlay-triggering commands, inspect the returned overlay payload; if `overlay.companion.launched` is false, surface `overlay.companion.reason` instead of assuming the overlay appeared

Close-out rule:

- when verification passes and no blocker remains, transition the task in the same turn
- do not leave finished implementation sitting in `pending` or `in_progress` just because code and tests are done
- if review or user signoff cannot happen yet, say exactly what is missing instead of silently leaving runtime stale

## Decision And Gotcha Rules

Use `.superplan/decisions.md` for meaningful execution choices, such as trajectory changes, major blocker handling, or review-routing decisions that future agents need to preserve.

Do not use it as a runtime event stream.

Use `.superplan/gotchas.md` for repeated execution traps, misleading repo behavior, unstable verification patterns, or subagent coordination failures likely to recur.

See `references/gotchas.md`.

## Handoff

Likely handoffs:

- `superplan-review`
- back to the user for feedback
- back to `superplan-shape` when structural trajectory change is detected
- back to `superplan-route` only when strategic trajectory change is detected

Internal support-skill usage may include:

- `superplan-debug`
- `superplan-tdd`
- `superplan-verify`

Execution handoff to `superplan-review` should name the evidence gathered and the CLI/runtime facts that support the review.

## CLI Hooks

Current CLI:

- `superplan task inspect show <task_ref> --json`
- `superplan run --json`
- `superplan run <task_ref> --json`
- `superplan task runtime block <task_ref> --reason <reason> --json`
- `superplan task runtime request-feedback <task_ref> --message <message> --json`
- `superplan task review complete <task_ref> --json`
- `superplan task repair fix --json`
- `superplan task repair reset <task_ref> --json`
- `superplan status --json`
- `superplan overlay ensure --json`
- `superplan overlay hide --json`

Future CLI hooks:

- `superplan task review`
- `superplan run dispatch`
- `superplan run reconcile`

## Validation Cases

Should execute:

- when one or more tasks are graph-ready and clearly actionable

Should dispatch subagents in parallel:

- when multiple ready tasks have disjoint write surfaces
- when verification can run independently of implementation without invalidating the result
- when one blocker can be investigated while other safe work continues

Should use the CLI control plane explicitly:

- `superplan run --json` to select or start work
- `superplan run <task_ref> --json` when one known task should become active explicitly
- `superplan task inspect show <task_ref> --json` when a specific task needs full detail or readiness explanation
- `superplan task runtime block ... --json` or `superplan task runtime request-feedback ... --json` when execution must pause
- `superplan task repair fix --json` when runtime state has drifted

Should avoid parallelism:

- when tasks depend on unstable shared assumptions
- when integration cost is likely to erase the speed benefit
- when verification depends on a moving implementation target
- when write conflicts are likely

Should not overclaim current CLI support:

- review-ready may be a workflow output without a persisted CLI review state
- `run` and `status` exist today, but richer `run dispatch` and `run reconcile` do not

Should classify trajectory change as local:

- implementation approach changes but task contract still holds
- verifier finds narrow fixable issues inside the same task

Should classify trajectory change as structural:

- a new dependency changes sequencing
- a task needs to split
- a task contract no longer describes the real work

Should classify trajectory change as strategic:

- the user's expectations changed
- the top-level goal changed
- the engagement or depth decision now looks materially wrong

Should block cleanly:

- when dependencies are unmet
- when a user decision is required
- when external information is missing

Should escalate instead of silently working around:

- broken graph structure
- malformed task contracts
- conflicting acceptance criteria
- major structural drift
- repeated execution churn that indicates shaping is no longer valid

Should not reshape casually:

- just because implementation is difficult
- just because the agent wants a different plan
