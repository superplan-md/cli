# Brainstorming Evals

Use these scenarios to test whether `superplan-brainstorm` restores the stronger Superpowers-style ambiguity discipline without absorbing Superplan workflow responsibilities.

## Eval Set

- `01-stay-out-casual-ideation.md`
- `02-brownfield-context-before-questions.md`
- `03-overscoped-request-decompose-first.md`
- `04-tiny-work-still-needs-short-design.md`
- `05-taste-sensitive-approach-approval.md`
- `06-substantial-spec-needs-artifact-review.md`
- `07-not-first-lane.md`

## Pass Criteria

- inspects repo or workspace context before asking avoidable questions
- never acts as the first lane for repo work that still needs `superplan-entry` or `superplan-route`
- asks one high-leverage question at a time
- detects overscoped work and decomposes before pretending one design can cover everything
- proposes `2-3` approaches with trade-offs and a recommendation
- requires explicit approval before planning or execution
- writes the minimum durable artifact instead of forcing a universal spec ritual
- hands control back to the owning workflow phase, usually `superplan-shape`
- stays inside superplan-brainstorm boundaries rather than absorbing `superplan-shape`

## Failure Signs

- treats casual ideation as mandatory Superplan work
- becomes the first lane for ambiguous repo work that should have entered through `superplan-entry`
- asks multiple shallow questions before checking the workspace
- jumps from ambiguity straight to tasks or execution
- presents one preferred approach as if no alternatives exist
- forces a change-scoped spec for tiny or already-clear work
- authors graph depth, autonomy policy, or execution sequencing that belongs to `superplan-shape` or `superplan-plan`
