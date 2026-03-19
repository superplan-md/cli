# Route Work Gotchas

Record recurring routing failures here.

## Add A Gotcha When

- the repo repeatedly gets over-shaped into `slice` or `program`
- serious work keeps getting under-shaped into `direct`
- missing context is repeatedly mistaken for a depth problem
- graph-shaped work keeps getting flattened into isolated task files

## A Surprise Becomes A Gotcha When

- the same routing mistake is likely to recur
- the request wording repeatedly misleads depth selection
- future agents would likely make the same over-shape or under-shape call
- the repo has a recurring brownfield trap that changes routing quality

## Skill-Specific Vs Workspace-Wide

- skill-specific: the trap is about engagement or depth judgment itself
- workspace-wide: the trap belongs to this repo, its product surface, or cross-skill verification behavior

Workspace-wide traps should go to `.superplan/gotchas.md`.

## Typical Routing Traps

- choosing `program` because the request sounds important
- choosing `task` when graph structure or workstreams are the real need
- routing to context bootstrap for every large repo regardless of actual need
- treating `.superplan/tasks/T-*.md` as the whole tracked model
- choosing `stay_out` for tiny real work that should still have a lightweight trace
- choosing `direct` for work that hides multi-surface or dependency risk

## Brownfield Traps

- local familiarity makes the context gap look smaller than it is
- one obvious file hides deeper product or architecture dependencies
- stale context creates false confidence during depth selection

## Logging Rule

Log the trap, not the entire story.
A good gotcha is short, reusable, and framed so a future router can avoid the same mistake.
