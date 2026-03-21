# Routing Boundaries

`superplan-entry` is an entry layer, not a workflow blob.

## It Owns

- checking whether Superplan should engage at all
- readiness guidance
- deferring to repo-native workflows before suggesting generic Superplan helpers
- choosing whether to stay out, resume a later phase, or enter routing
- routing to `superplan-route`
- routing to `superplan-context` when missing context is the blocker
- routing to `superplan-execute` when work is already shaped and should move
- routing to `superplan-review` when the request is really a completion gate
- choosing the next workflow lane, not the inner support discipline directly

## It Does Not Own

- depth choice
- shaping artifacts
- execution
- completion review
- direct invocation of support disciplines as the primary route, except through the owning workflow phase

## Direct Routing Table

- simple answer with no durable value: stay out
- new repo work where engagement or depth is still open: `superplan-route`
- serious brownfield repo missing durable context: `superplan-context`
- tracked work that should continue now: `superplan-execute`
- completion or unblock judgment against a task contract: `superplan-review`

## Workspace Precedence

- inspect only enough of the repo to choose the right workflow lane
- prefer user-owned harnesses, scripts, custom skills, and repo-native workflows
- use Superplan to coordinate those workflows rather than replacing them
- only add generic Superplan help when the workspace does not already provide a better path
- never let a Superplan-specific helper outrank a working user-owned setup
- once the lane is clear, stop reading and hand off

## Workflow Spine Vs Support Skills

Use the workflow spine for phase ownership:

- engagement and depth: `superplan-route`
- shaping and trajectory: `superplan-shape`
- forward motion: `superplan-execute`
- completion authority: `superplan-review`
- durable context: `superplan-context`

Use support skills inside those phases:

- `superplan-brainstorm`
- `superplan-plan`
- `superplan-debug`
- `superplan-tdd`
- `superplan-verify`

## Boundary Tests

- If the next question is "how much structure?", use `superplan-route`.
- If the next question is "is Superplan even ready here?", stay in `superplan-entry`.
- If the next question is "what artifacts should exist?", use `superplan-shape`.
- If the next question is "what work is ready now?", use `superplan-execute`.
- If the next question is "is this task actually done?", use `superplan-review`.
- If the next question is "what stable repo truth are we missing before serious work?", use `superplan-context`.

## Common Wrong Moves

- routing "continue T-003" back to `superplan-route`
- routing "is this done?" back to `superplan-execute`
- routing directly to `superplan-brainstorm` or `superplan-debug` from the entry layer
- treating missing setup and missing init as the same readiness failure
- suggesting a generic Superplan helper when the repo already has a better native workflow
