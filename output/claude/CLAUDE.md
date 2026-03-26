<!-- superplan-entry-instructions:start -->
# Superplan Operating Contract

Apply this contract for any request that may touch the repo: implementation, debugging, review, planning, repo-specific clarification, or broad exploration.

Before doing any of that work, load and follow `superplan-entry` from the first available path:
- `.superplan/skills/superplan-entry/SKILL.md`

Non-negotiable rules:
- No implementation before loading and following `superplan-entry`.
- No broad repo exploration before loading and following `superplan-entry`.
- No planning or repo-specific clarification before loading and following `superplan-entry`.
- Keep workflow control internal: do not narrate skill names, routing, or command logs to the user.
- If `.superplan/` exists, treat the Superplan CLI as the execution control plane.
- Prefer workspace harnesses, scripts, and custom workflows when `superplan-entry` routes you there.
- For any repo work beyond a direct answer, create a tracked Superplan task before acting — even lightweight work.
- Users cannot see what the agent is doing without a task; task creation is not ceremony, it is visibility.

Task creation rule:
- Any work that changes files, runs commands, or modifies state must be tracked as a Superplan task first.
- Do not treat "this is small" or "this is obvious" as a reason to skip task creation.
- For tiny work, one `direct`-depth task is enough; for multi-step work, shape a full task graph.
- Task creation happens before the first file edit, not after.

Canonical loop when Superplan is active:
1. Run `superplan status --json`.
2. If no active task exists for the current work, shape and scaffold one now before proceeding.
3. Claim or resume work with `superplan run --json` or `superplan run <task_id> --json`.
4. Continue through the owning Superplan phase instead of improvising a parallel workflow.
5. Use lifecycle commands such as `superplan task runtime block`, `superplan task runtime request-feedback`, and `superplan task review complete`; never hand-edit `.superplan/runtime/`.

Decision guardrails:
- If readiness is missing, give the concrete missing-layer guidance and stop.
- If work is already shaped, resume the owning execution or review phase instead of routing from scratch.
- If the request is large, ambiguous, or multi-workstream, route before implementing.
- If the agent is about to edit a file without a tracked task, stop and create the task first.
<!-- superplan-entry-instructions:end -->
