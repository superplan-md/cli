# Depth Modes

Structure depth is a workflow choice.
Choose the smallest mode that preserves trust, visibility, and correct downstream shaping.
Do not use "smallest" as an excuse to skip clarification, spec, or plan work when ambiguity is the real blocker.

## `stay_out`

Use when:

- the user wants a direct answer or explanation
- no durable artifact or reusable context would help
- the work is conversational or one-shot

Examples:

- "Explain this regex."
- "Summarize this paragraph."
- "What does this function do?"

Result:

- answer directly
- create no Superplan artifacts

## `direct`

Use when:

- the work is tiny, obvious, and low-risk
- a lightweight trace still helps visibility
- fuller shaping would be ceremony

Examples:

- fix a typo in one docs file
- make one obvious config rename
- update one small copy string in the app

Result:

- usually create `tasks.md` plus one lightweight task contract
- then hand off for immediate execution

## `task`

Use when:

- one bounded, reviewable unit is enough
- the work needs a normal task contract and clear acceptance criteria
- graph structure is not the main coordination problem

Examples:

- fix one contained bug in a single service
- add one small feature with clear AC
- refactor one isolated module without branching work

Result:

- `tasks.md`
- one normal task contract

## `slice`

Use when:

- the work is bounded but non-trivial
- sequencing or decomposition matters
- one workstream contains multiple meaningful steps
- the request is clear enough that a small plan and graph can be trusted without broader clarification

Examples:

- add a feature that needs UI, API, and one migration in a coordinated order
- refactor a subsystem with a short execution path and a few dependent tasks
- ship one bounded workflow that needs planning more than spec clarification

Result:

- usually `plan.md`
- `tasks.md`
- `tasks/T-*.md`
- specs only when target misunderstanding is the bigger risk than sequencing

## `program`

Use when:

- the work is broad, ambiguous, or multi-workstream
- multiple interfaces or product truths need durable alignment
- richer artifact structure is needed before execution stays trustworthy
- the raw request is a dense requirement dump, JTBD list, or multi-constraint brief that should not be trusted as a final task graph yet

Examples:

- redesign a major cross-surface workflow
- multi-service architecture work with several dependency branches
- large brownfield initiative where multiple teams or workstreams could diverge

Result:

- clarification or brainstorm output when expectations are still unclear
- `plan.md`
- `tasks.md`
- `tasks/T-*.md`
- one or more specs where durable clarification is needed

## Graph Reminder

For `slice` and `program`, preserve:

- graph truth in the graph/index layer
- task-contract truth in task files
- runtime truth in execution state

Do not flatten graph-shaped work into a pile of task files.
