# Using Superplan Evals

## Should Trigger

- "Implement this feature and keep the work organized."
- "Set this repo up so future agent work is trackable."
- "Continue the next ready task."
- "Is T-003 actually done?"
- "I want to use Superplan in this repo."

## Should Stay Out

- "Explain this function."
- "Summarize this paragraph."
- "What does this regex mean?" with no durable workflow value
- "Translate this message."
- casual conversation with no repo work or durable value

## Ambiguous Boundary

- "Fix this tiny typo."
- "Look into this bug."
- "Write a quick recommendation doc."

## Overlap Boundary

- confirm it routes to `superplan-route` rather than choosing `superplan-brainstorm` or `superplan-debug` as the entry lane
- confirm "continue T-003" routes to `superplan-execute`, not `superplan-route`
- confirm "is this task done?" routes to `superplan-review`, not `superplan-execute`
- confirm a brand-new request in the same chat does not silently resume an older active or interrupted task
- confirm unrelated dirty worktree state is treated as contamination risk, not as proof the new request should inherit old work

## Handoff Check

- if setup or init is missing, the output is readiness guidance rather than a workflow handoff
- if context is the missing readiness layer, handoff is `superplan-context`
- if engagement is warranted but depth is unknown, handoff is `superplan-route`
- if work is already shaped and should continue, handoff is `superplan-execute`
- if the request is completion authority, handoff is `superplan-review`

## Readiness Matrix

- CLI missing in a host that expects Superplan: give readiness guidance for installation or availability
- repo not initialized but the CLI exists and Superplan should engage: run `superplan init --yes --json` and continue
- host setup missing but the CLI exists: do not let that block repo-local init by itself
- init present but serious brownfield context missing: route `superplan-context`

## Workspace Precedence

- repo already has a working verification or orchestration harness: inspect it and defer to it instead of inventing a generic Superplan helper
- repo already exposes a custom skill or script for the relevant workflow: Superplan should coordinate around it, not replace it

## Metadata Check

- description should stay trigger-only and should not summarize routing flow or inner workflow phases
- metadata should remain sharp enough for auto-triggering in hosts that index only `name` and `description`

## Pressure Scenario

- repo work request arrives in a partially initialized brownfield repo where Superplan may help, but a direct answer might still be enough if no durable value is created
- request arrives inside a bounded execution subagent and the skill must skip top-level rerouting
- repo instructions conflict with a default Superplan habit and the skill must honor repo instructions
- repo has a strong user-owned workflow and the skill must supervise rather than seize control
- a fresh request arrives while another task is already active in this chat
- an interrupted task is still waiting in the same chat when the user asks for different work
- the checkout is dirty from another session and the new request may or may not overlap those edits

## Scenario Files

- `01-fresh-request-active-task.md`
- `02-interrupted-session-different-request.md`
- `03-unrelated-dirty-worktree.md`

## Pass Condition

The skill stays brief, does not shape artifacts itself, distinguishes workflow skills from support skills, preserves outer entry discipline, keeps metadata trigger-only, handles CLI vs setup vs init vs context readiness distinctly, defers to user-owned workflows, keeps session focus from hijacking fresh requests, treats unrelated dirty diffs as explicit risk instead of hidden context, and routes cleanly to the owning workflow phase.
