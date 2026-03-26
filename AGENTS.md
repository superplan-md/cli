<!-- superplan-entry-instructions:start -->
# Superplan Operating Contract

Apply this contract for any request that may touch the repo: implementation, debugging, review, planning, repo-specific clarification, or broad exploration.

Before doing any of that work, load and follow `superplan-entry` from the first available path:
- `/Users/ishashank/.config/superplan/skills/superplan-entry/SKILL.md`

Non-negotiable rules:
- No implementation before loading and following `superplan-entry`.
- No broad repo exploration before loading and following `superplan-entry`.
- No planning or repo-specific clarification before loading and following `superplan-entry`.
- Keep workflow control internal: do not narrate skill names, routing, or command logs to the user.
- If `.superplan/` exists, treat the Superplan CLI as the execution control plane.
- Prefer workspace harnesses, scripts, and custom workflows when `superplan-entry` routes you there.

Canonical loop when Superplan is active:
1. Run `superplan status --json`.
2. Claim or resume work with `superplan run --json` or `superplan run <task_id> --json`.
3. Continue through the owning Superplan phase instead of improvising a parallel workflow.
4. Use lifecycle commands such as `superplan task runtime block`, `superplan task runtime request-feedback`, and `superplan task review complete`; never hand-edit `.superplan/runtime/`.

Decision guardrails:
- If readiness is missing, give the concrete missing-layer guidance and stop.
- If work is already shaped, resume the owning execution or review phase instead of routing from scratch.
- If the request is large, ambiguous, or multi-workstream, route before implementing.
<!-- superplan-entry-instructions:end -->
