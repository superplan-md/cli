# Shape Work Evals

## Should Trigger

- bounded multi-step work needing plan and tasks
- ambiguous work needing investigation or a decision gate

## Should Stay Out

- direct answer requests already satisfied

## Ambiguous Boundary

- work that could be either one normal task or a plan plus tasks depending on verification and expectation risk

## Overlap Boundary

- confirm it shapes trajectory and artifacts without drifting into live execution
- confirm structural uncertainty produces investigation or decision-gate work rather than fake certainty
- confirm it distinguishes current CLI commands from future CLI hooks
- confirm it does not claim `tasks.md` is currently parsed by the CLI

## Handoff Check

- execution-ready frontier hands off to `execute-task-graph`
- invalid depth discovery routes back to `route-work`
- approval-sensitive shaping pauses for user review
- current CLI validation path is named explicitly before execution handoff

## Pressure Scenario

- repo work with unclear verification path, hidden expectation risk, and partial brownfield context

## Pass Condition

The skill produces a concrete trajectory, explicit frontier, verification plan, interruption points, re-shape triggers, an honest current-CLI validation path, and a clear execution handoff without forcing unnecessary ceremony.
