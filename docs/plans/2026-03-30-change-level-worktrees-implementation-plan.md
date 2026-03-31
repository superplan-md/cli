# Change-Level Worktrees Implementation Plan

Date: 2026-03-30

Status: proposed

## Goal

Add concurrent change execution to Superplan without changing the product rule that execution is change-level.

The target operating model is:

- one active task per change
- multiple changes may be active at the same time
- one checkout or worktree may only be attached to one active change at a time
- concurrent active changes should be isolated by execution root when needed
- shared Superplan control-plane state must stay unified across all worktrees of the same Git repo

This document is intentionally grounded in the current codebase and Git behavior rather than an idealized redesign.

## Why This Exists

Current behavior mixes two concerns that need to be separated:

- project-scoped control-plane truth
- checkout-scoped execution isolation

Today, Superplan state is keyed from the current checkout path. That was acceptable when there was effectively one checkout per repo session, but it becomes incorrect once linked Git worktrees are introduced.

If worktrees are added before identity and state ownership are fixed, the CLI will fork its own control plane across worktrees and create more confusion than it removes.

## Ground Truth From The Current Code

These are the important implementation facts the plan must respect.

### State Identity

- `resolveWorkspaceRoot()` returns the current checkout root by walking up to `.git`.
- `resolveSuperplanRoot()` derives the Superplan state root from that checkout root and the checkout basename.
- This means linked worktrees of the same repo would currently get different Superplan state roots.

Relevant files:

- `src/cli/workspace-root.ts`
- `src/cli/global-superplan.ts`

### Shared Runtime Surfaces

The following command and runtime surfaces all read or write under the current derived Superplan root:

- tracked changes and parse lookup
- runtime task state
- session focus state
- visibility reports
- context and durable workspace memory
- doctor health checks

Relevant files:

- `src/cli/commands/parse.ts`
- `src/cli/commands/task.ts`
- `src/cli/session-focus.ts`
- `src/cli/visibility-runtime.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/change-metrics.ts`

### Drift Baselines

- worktree snapshots are already checkout-specific and based on the current execution root
- this is correct and should be preserved

Relevant file:

- `src/cli/worktree-snapshot.ts`

### Runtime Writes

- task runtime state and session focus are written via plain `fs.writeFile`
- there is no locking or compare-and-swap protection
- multiple sessions or worktrees writing shared state would race today

Relevant files:

- `src/cli/commands/task.ts`
- `src/cli/session-focus.ts`

### Existing Atomic-Write Pattern

- overlay snapshot and control writes already use temp-file plus rename
- that pattern can be copied for shared-state writes

Relevant file:

- `src/cli/overlay-runtime.ts`

### Real Git Worktree Support Exists

The current repo already has a secondary worktree, and Git exposes:

- a different `git-dir` per worktree
- a shared `git-common-dir` across all worktrees

This is exactly the primitive needed to distinguish:

- per-checkout identity
- shared repo identity

## Product Decisions

These are the explicit decisions this implementation plan assumes.

### Decision 1: Concurrency Stays Change-Level

Superplan does not move to a workspace-wide single-active-task rule.

Allowed:

- `change-a/T-001` active
- `change-b/T-001` active

Not allowed:

- `change-a/T-001` active
- `change-a/T-002` active

### Decision 2: Worktrees Are An Execution Isolation Layer

Worktrees do not create a new project or new Superplan control plane.

They only provide:

- filesystem isolation
- branch isolation
- diff isolation
- session isolation when multiple changes execute concurrently

### Decision 3: Worktrees Should Not Be Created For Every Secondary Change

Use a worktree when there is concurrent execution pressure, not merely when more than one change exists.

Sequential behavior should stay cheap:

- if the current checkout is free and the user is switching work sequentially, reuse it
- if the current checkout is already attached to another active change, isolate the second active change in a worktree

### Decision 4: Shared Control-Plane State Must Be Project-Scoped

All worktrees of the same Git repo must share:

- tracked changes
- task runtime state
- session focus records
- visibility reports
- context artifacts
- doctor and repair truth

### Decision 5: Drift And Edit Claims Must Stay Execution-Root-Scoped

Edit drift, baseline snapshots, and file mutations must stay tied to the actual checkout being edited.

## Core Definitions

These terms should be added to the implementation model and docs.

### `project_id`

A stable identity shared by all worktrees of the same Git repo.

For Git repos:

- derived from normalized `git rev-parse --git-common-dir`
- hashed to a short stable id safe for paths

For non-Git directories:

- derived from normalized workspace root path

### `project_state_root`

The shared Superplan state directory for a `project_id`.

This replaces the current “one Superplan root per checkout path” behavior.

### `execution_root`

The actual checkout path where repo commands and file edits happen.

Examples:

- primary checkout root
- linked Git worktree path

### `root_id`

A stable identifier for one execution root, derived from the normalized absolute execution-root path.

### `primary_checkout`

The current main checkout the user launched the session from or the canonical repo root checkout.

### `managed_worktree`

A worktree that Superplan created or explicitly adopted and registered in runtime state.

### `attached_change`

The change currently associated with an execution root for tracked work.

## Non-Goals

These items are out of scope for the first implementation.

- full branch stack management
- automatic merge/rebase/cherry-pick orchestration
- hidden adoption of arbitrary user-created worktrees
- automatic worktree creation for every non-primary change
- changing `task_file_path` into a logical or fake path
- making overlay UI fully project-global in the first pass
- non-Git multi-root orchestration

## Required Invariants

These are the invariants the code must enforce after rollout.

1. All worktrees of the same Git repo resolve to the same `project_state_root`.
2. One change may have at most one in-progress task at a time.
3. One execution root may be attached to at most one active change at a time.
4. Multiple active changes across distinct execution roots are valid.
5. Session focus is project-scoped but execution-root-aware.
6. Edit drift is evaluated against the session's attached execution root only.
7. Shared runtime/session state writes are atomic and serialized.
8. `task repair fix` must not repair away valid concurrency across different changes.

## Target UX

### Sequential Work In One Checkout

Expected behavior:

- user starts in the primary checkout
- `run` or `quick` activates a change there
- user finishes or pauses that change
- user starts another change
- if the checkout is free and the switch is sequential, Superplan reuses the same checkout

### Concurrent Work Across Multiple Changes

Expected behavior:

- primary checkout is already attached to `change-a`
- user starts `change-b`
- Superplan does not block the whole repo
- Superplan returns or ensures a dedicated execution root for `change-b`
- subsequent `run` in that session continues `change-b` in its attached execution root

### Explicit Resume

Expected behavior:

- `superplan run change-a/T-001 --json` remains valid
- if the task is active in another execution root, the response must surface that execution root rather than pretending the current checkout is correct

### `quick` / Single-Task Fast Path

Expected behavior:

- create change and `T-001`
- attach to a free execution root if available
- otherwise return a worktree-routing next action instead of repo-wide blocking

### Doctor

Expected behavior:

- distinguish project health from current execution-root health
- report stale or missing managed worktrees
- report attachment drift
- avoid blaming unrelated changes living in other execution roots

## Architecture Changes

## 1. Add A Project Identity Layer

Add a new module:

- `src/cli/project-identity.ts`

Responsibilities:

- resolve whether the current directory is inside a Git repo
- return normalized absolute `workspace_root`
- return normalized absolute `git_dir`
- return normalized absolute `git_common_dir`
- compute `project_id`
- expose `project_state_root`
- expose `is_linked_worktree`

Recommended API:

```ts
interface ProjectIdentity {
  workspace_root: string;
  project_id: string;
  project_state_root: string;
  is_git_repo: boolean;
  is_linked_worktree: boolean;
  git_dir: string | null;
  git_common_dir: string | null;
}
```

Implementation notes:

- use `git rev-parse --show-toplevel`, `--git-dir`, and `--git-common-dir` when in a Git repo
- normalize all returned paths via realpath where possible
- hash the normalized identity input to form `project_id`
- keep `resolveWorkspaceRoot()` as “current checkout root”
- stop using checkout basename as the actual project identity

Why this is feasible:

- Git already exposes the exact shared-vs-local distinction needed
- the repo already has a linked worktree, so this can be tested concretely

## 2. Split Checkout Root From Shared State Root

Refactor `resolveSuperplanRoot()` behavior into two concepts:

- `workspace_root`: where execution happens
- `project_state_root`: where shared Superplan state lives

Files to update:

- `src/cli/workspace-root.ts`
- `src/cli/global-superplan.ts`
- `src/cli/commands/parse.ts`
- `src/cli/commands/task.ts`
- `src/cli/session-focus.ts`
- `src/cli/change-metrics.ts`
- `src/cli/visibility-runtime.ts`
- `src/cli/commands/doctor.ts`
- `src/cli/overlay-runtime.ts`

Required result:

- all worktrees of the same repo read the same tracked changes and runtime/session state
- display paths remain logical and stable
- execution-specific operations still use the actual checkout root

## 3. Add State Migration

Add a migration module:

- `src/cli/state-migration.ts`

Responsibilities:

- detect legacy checkout-keyed Superplan roots
- migrate them into the new project-keyed root when safe
- detect ambiguous legacy cases and stop instead of auto-merging

Safe migration case:

- one legacy root maps to one project id

Unsafe migration case:

- multiple legacy roots would collapse into one project id
- content conflicts exist in runtime or changes

In unsafe cases:

- emit a doctor issue
- do not mutate anything automatically

Why this matters:

- once worktrees share one project state root, silent merging of old divergent state would be dangerous

## 4. Add Atomic Shared-State IO And Locking

Add:

- `src/cli/state-lock.ts`
- `src/cli/state-store.ts`

Responsibilities:

- create per-project lock files for mutating operations
- use temp-file plus rename writes
- detect stale locks
- provide short retry loops for concurrent sessions

Lock coverage in v1:

- `runtime/tasks.json`
- `runtime/session-focus.json`
- `runtime/execution-roots.json`
- any shared project-level runtime report index if later needed

Implementation notes:

- one project-level lock is acceptable for v1
- finer-grained locking can wait
- do not attempt cross-platform advisory file locks in v1
- exclusive-create lockfiles plus stale timeout is enough initially

Required refactors:

- wrap current writes in `src/cli/commands/task.ts`
- wrap current writes in `src/cli/session-focus.ts`
- wrap current runtime rewrites in `src/cli/commands/change.ts`
- optionally port `visibility-runtime.ts` onto the same helper for consistency

Why this is mandatory:

- today’s plain `fs.writeFile` is not safe under concurrent sessions across worktrees

## 5. Add Execution-Root Registry

Add:

- `src/cli/execution-roots.ts`

Shared runtime file:

- `runtime/execution-roots.json`

Schema:

```json
{
  "version": 1,
  "roots": {
    "<root_id>": {
      "path": "/abs/path/to/execution/root",
      "kind": "primary|worktree",
      "branch": "sp/change-slug",
      "head": "abc123",
      "attached_change_id": "change-slug",
      "owner_session_id": "session-A",
      "status": "attached|detached|missing|stale",
      "created_at": "ISO-8601",
      "updated_at": "ISO-8601"
    }
  }
}
```

Responsibilities:

- register the current primary checkout
- register managed worktrees
- map change attachment to execution root
- detect missing paths
- mark stale or detached roots

Important rule:

- this registry describes execution routing only
- task lifecycle truth still lives in `runtime/tasks.json`

## 6. Extend Session Focus

Extend session focus entries in:

- `src/cli/session-focus.ts`

Add fields:

- `execution_root_id`
- `execution_root_path`
- `execution_root_kind`
- `attached_change_id`

Preserve:

- `focused_change_id`
- `focused_task_ref`
- `worktree_baseline`

New semantics:

- session focus is project-scoped
- execution attachment is checkout-scoped
- worktree baseline belongs to the session plus execution root, not only to the task ref

Required behavior:

- when a session claims a task, it also records the execution root
- when the session switches to a different execution root, baseline capture resets accordingly

## 7. Add Explicit Worktree Commands

Add:

- `src/cli/git-worktree.ts`
- `src/cli/commands/worktree.ts`

Register in:

- `src/cli/router.ts`
- `src/cli/main.ts`

Commands for v1:

- `superplan worktree ensure <change>`
- `superplan worktree list`
- `superplan worktree detach <change>`
- `superplan worktree prune`

### `worktree ensure`

Responsibilities:

- if current execution root is already attached to that change, reuse it
- if an existing managed worktree is already attached to that change and still exists, reuse it
- if current execution root is free, clean enough, and not attached to another active change, attach it instead of creating a worktree
- otherwise create a managed worktree

Default path:

- `../.superplan-worktrees/<repo-name>/<change-slug>`

Default branch:

- `sp/<change-slug>`

Base commit:

- current HEAD of the primary checkout or current checkout, whichever is designated as the creation source

### `worktree list`

Responsibilities:

- show managed execution roots
- show attached changes
- show path existence
- show branch and status

### `worktree detach`

Responsibilities:

- clear attachment metadata for a change
- do not delete the worktree automatically in v1

### `worktree prune`

Responsibilities:

- mark or remove stale registry entries
- optionally call `git worktree prune`
- never delete a live path without explicit confirmation or a stronger policy

Why explicit commands come first:

- the CLI cannot change the user’s shell cwd
- routing must be inspectable before it becomes implicit

## 8. Restore Change-Level Activation Semantics

This is the critical semantic correction after the recent workspace-wide hardening.

In `src/cli/commands/task.ts` split “other active task” logic into:

- another in-progress task in the same change
- another active change attached to the same execution root

Rules:

- the first is invalid and should block activation
- the second is valid globally and should trigger execution-root routing, not repo-wide blocking

This affects:

- `startTask`
- `resumeTask`
- `activateTask`
- `selectNextTask`
- `buildTaskReasons`
- repair logic assumptions

Important:

- `task repair fix` must remain per-change
- it must not reset another change’s active task in another execution root

## 9. Make `run` Execution-Root-Aware

Update:

- `src/cli/commands/run.ts`

New payload fields:

- `project_id`
- `execution_root`
- `execution_root_kind`
- `execution_root_attached_change_id`
- `worktree_required`
- `worktree_next_action` if applicable

Behavior:

- if the current session already has a valid attached execution root, prefer it
- if the chosen change is attached to a different execution root, return that root context
- if the current execution root is occupied by another active change, do not block repo-wide; return the worktree ensure path
- bare `run` remains session-local but does not pretend other execution roots do not exist

Required constraint:

- the agent must know which execution root to run repo commands in

## 10. Put `quick` And Single-Task Flows On Top Of Execution Routing

Update:

- `src/cli/commands/quick.ts`
- `src/cli/commands/change.ts`

Behavior:

- create tracked change and `T-001`
- if current execution root is free, attach and activate there
- if occupied by another active change, return a `worktree ensure` next action
- if the change already has a managed execution root, reuse it

Important:

- `quick` should stay honest and low-ceremony
- it should not silently create hidden parallel execution in the same checkout
- it should not fall back to repo-wide blocking when the real answer is isolated execution

## 11. Keep Drift Checks Execution-Root-Specific

Update:

- `src/cli/workspace-health.ts`
- `src/cli/commands/doctor.ts`

Rules:

- edit drift checks inspect the current session’s attached execution root
- project-global runtime state is still shared
- another active change in another execution root should not count as local drift

Add new doctor issue classes:

- missing managed worktree path
- branch mismatch in managed worktree
- execution root attached to archived change
- stale lockfile
- ambiguous legacy state migration
- attached execution root no longer matches recorded head or branch expectations

## 12. Keep Overlay Execution-Root-Scoped In V1

Update carefully:

- `src/cli/overlay-runtime.ts`

Decision:

- keep overlay control and snapshot files keyed by concrete execution root in v1
- source tracked changes from the shared project state root

Reason:

- one worktree’s overlay view should not stomp another’s
- fully project-global overlay coordination is a separate design problem

## 13. Update Installed Guidance Last

After the runtime and command model are stable, update:

- `src/cli/commands/install-helpers.ts`
- `src/cli/main.ts`
- `src/cli/router.ts`

New guidance must say:

- concurrency is change-level
- execution roots isolate concurrent changes
- `run` or `quick` may return execution-root routing instead of repo-wide blocking
- control-plane state is shared across worktrees of the same repo

Do not update the generated contract text before the implementation is actually true.

## Command Semantics In Detail

## `run --json`

Sequential case:

- keep using current execution root
- return active task as usual

Concurrent case:

- if session is already attached to a different execution root, return that execution root in the payload
- if current root is occupied by another active change and the requested work needs execution, return a worktree-routing next action

## `run <task_ref> --json`

Rules:

- explicit task refs remain valid
- if task is active in another execution root, response must surface where it lives
- do not pretend the current checkout is the right place to continue

## `quick`

Rules:

- never create two active changes in the same execution root
- never block the whole repo just because another change is active elsewhere
- return the exact next action needed to obtain or switch to the correct execution root

## `task repair fix`

Rules:

- repair only same-change multiple-in-progress conflicts
- keep dependency blocking behavior per task
- do not “repair” valid cross-change concurrency

## `doctor --json`

Must report separately:

- project-state health
- current execution-root health
- managed worktree registry health

## Migration Strategy

### Phase 1 Migration: Identity Only

- add project identity helpers
- keep the current checkout-based state root readable
- do not write into the new root until migration is performed

### Phase 2 Migration: Shared State Root

- migrate safe single-source legacy roots into the new project root
- write a migration marker file
- keep a backup copy of the legacy root metadata

### Phase 3 Migration: Execution-Root Registry

- register the current checkout as the primary execution root on first mutating command

### Ambiguous Migration Handling

If two legacy state roots map to the same new `project_id`:

- do not auto-merge
- emit a doctor issue
- require explicit repair tooling later if needed

## Implementation Order

This order is chosen to minimize breakage and avoid designing on top of false assumptions.

### Phase A: Identity And Shared State Root

1. Add `project-identity.ts`
2. Add `resolveProjectStateRoot()`
3. Refactor shared-state readers onto project identity
4. Add migration scaffolding

Acceptance criteria:

- primary checkout and linked worktree resolve the same project state root
- unrelated repos with same basename do not collide

### Phase B: Atomic Shared-State IO

5. Add project-level locking
6. Convert runtime/session writes to temp-write plus rename
7. Add stale lock detection

Acceptance criteria:

- concurrent child-process writes do not produce torn JSON
- lost updates are detectable or prevented

### Phase C: Execution-Root Registry

8. Add `execution-roots.ts`
9. Register current checkout as primary execution root
10. Extend session focus with execution attachment

Acceptance criteria:

- session focus persists execution-root identity
- registry survives restart and can detect missing paths

### Phase D: Explicit Worktree Commands

11. Add `worktree ensure`
12. Add `worktree list`
13. Add `worktree detach`
14. Add `worktree prune`

Acceptance criteria:

- Superplan can create and reuse managed worktrees
- branch and path collisions are handled explicitly

### Phase E: Change-Level Activation Restore

15. Refactor activation logic in `task.ts`
16. Refactor `run.ts` selection and payloads
17. Refactor `quick.ts` and single-task flows

Acceptance criteria:

- multiple active changes across execution roots are allowed
- same-change double activation is still rejected
- repo-wide blocking is removed where execution-root routing is the correct response

### Phase F: Health And Overlay

18. Update doctor and workspace health
19. Update overlay tracked-change sourcing
20. Add stale execution-root and lock issues

Acceptance criteria:

- drift is local to the attached execution root
- doctor exposes missing/stale managed worktree conditions cleanly

### Phase G: Contract And Docs

21. Update CLI help
22. Update installed entry contract
23. Add user-facing worktree semantics documentation

Acceptance criteria:

- help text matches actual routing behavior
- installed contract no longer implies repo-wide exclusivity

## Test Plan

Add or extend the following suites.

### `test/project-identity.test.cjs`

Cover:

- primary Git checkout
- linked worktree
- detached worktree
- non-Git fallback
- two unrelated repos with same basename

### `test/state-lock.test.cjs`

Cover:

- concurrent session-focus writes
- concurrent runtime writes
- stale lock recovery
- temp-write plus rename integrity

### `test/execution-roots.test.cjs`

Cover:

- registering primary checkout
- attaching a change
- missing path detection
- stale registry entry
- owner session reassignment rules

### `test/worktree.test.cjs`

Cover:

- ensure creating a new worktree
- ensure reusing a managed worktree
- existing branch collision
- detached HEAD source
- prune stale entries
- detach without deleting filesystem path

### `test/task.test.cjs`

Extend to cover:

- two active changes in different execution roots are valid
- two active tasks in the same change are invalid
- explicit continue surfaces remote execution-root context correctly
- `repair fix` does not reset another change's active task

### `test/quick.test.cjs`

Extend to cover:

- primary checkout free
- primary checkout occupied by another active change
- existing managed worktree reused for the same change

### `test/doctor.test.cjs`

Extend to cover:

- missing managed worktree path
- stale lockfile
- branch mismatch
- archived change still attached to an execution root
- ambiguous legacy migration

### `test/scaffold.test.cjs`

Extend to cover:

- shared project-state root still yields stable logical `.superplan/...` display paths from any worktree

### `test/lifecycle.test.cjs`

Extend to cover:

- installed contract/help mentions worktree-aware execution routing only after the commands exist

### `test/overlay-cli.test.cjs`

Extend to cover:

- overlay snapshot remains execution-root-scoped
- tracked changes come from shared project state

## Edge Cases That Must Be Explicitly Handled

These are not optional polish items. They must be designed before coding.

### Identity Edge Cases

- two repos with the same basename
- repo moved to a different absolute path
- worktree path moved or deleted
- non-Git directory

### Git Edge Cases

- detached HEAD
- branch already checked out in another worktree
- user manually switched branches inside a managed worktree
- worktree created externally and not yet managed by Superplan
- dirty primary checkout when a concurrent change begins
- sparse checkout or submodules

### Runtime Edge Cases

- concurrent sessions writing shared JSON
- interrupted worktree creation leaving partial registry state
- active task exists but attached execution root path is gone
- archived change still attached to a managed execution root

### UX Edge Cases

- session starts in primary checkout but the intended active change lives elsewhere
- user runs CLI from the wrong checkout
- user explicitly resumes a task belonging to another execution root
- user wants sequential switching and should not pay the worktree cost

## Open Questions

These questions are real but do not block the first implementation if the defaults below are accepted.

1. Should `worktree ensure` use the current checkout HEAD or the primary checkout HEAD as the default base commit?
   Recommended v1 answer: current checkout HEAD, documented explicitly.

2. Should Superplan auto-adopt an existing user-created worktree for a change?
   Recommended v1 answer: no automatic adoption; require explicit attach or ensure reuse only for managed roots.

3. Should `worktree detach` ever delete the worktree path?
   Recommended v1 answer: no; prune is separate.

4. Should a dirty but unattached checkout be auto-reused for new tracked work?
   Recommended v1 answer: only if the user is clearly continuing there sequentially; otherwise stop and surface the dirtiness.

## Exit Criteria

This plan is complete when:

- shared project identity is no longer checkout-path-based
- linked worktrees share one Superplan control plane
- change-level concurrency works without repo-wide blocking
- execution-root routing is explicit in command responses
- shared-state writes are lock-protected and atomic
- doctor and drift checks are execution-root-aware
- the installed agent contract reflects the implemented behavior

Until those conditions are met, worktree support should remain behind an experimental gate.
