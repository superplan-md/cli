# Shape Work Gotchas

Record recurring shaping failures here.

## Add A Gotcha When

- shaping repeatedly chooses the wrong verification path
- uncertainty is repeatedly hidden behind overconfident plans
- specs repeatedly drift into pseudocode
- a repo pattern keeps misleading artifact selection
- the product target `tasks.md` graph is repeatedly mistaken for current CLI-validated truth
- `superplan doctor` keeps getting treated as artifact validation
- future CLI commands keep getting referenced as if they already exist

## A Surprise Becomes A Gotcha When

- it is likely to distort shaping again
- it reveals a repeated artifact-selection or verification-selection failure
- future agents would repeat the same shaping mistake without the note

## Skill-Specific Vs Workspace-Wide

- skill-specific: the trap is about shaping judgment, trajectory design, or artifact choice
- workspace-wide: the trap belongs to the repo, product surface, or recurring cross-skill verification issues

Workspace-wide traps should go to `.superplan/gotchas.md`.

## Keep Out

- one-off decomposition mistakes
- execution-only issues that belong to runtime or review
