# Using Superplan Gotchas

Record workflow traps specific to entry and readiness.

## Add A Gotcha When

- the host looks Superplan-ready but is missing a critical prerequisite
- setup and init are repeatedly confused in this host or repo
- the repo repeatedly gets over-routed into structure for trivial requests
- already-shaped work keeps getting bounced back to `route-work`
- bounded subagents keep rerunning top-level entry routing
- missing brownfield context keeps causing bad downstream shaping

## A Surprise Becomes A Gotcha When

- it is likely to waste time again
- it reveals a misleading default or repeated routing failure
- future agents would make the same wrong entry decision without the note

## Skill-Specific Vs Workspace-Wide

- skill-specific: the trap is about entry or readiness judgment itself
- workspace-wide: the trap belongs to this repo, product surface, or a cross-skill recurring verification issue

Workspace-wide traps should go to `.superplan/gotchas.md`.

## Do Not Add A Gotcha For

- one-off conversational requests
- generic advice like "be concise"
- transient repo noise that does not recur
