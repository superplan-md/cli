# Review Task Against AC Evals

## Should Trigger

- task claims completion and downstream work may unblock
- key AC need proof-source judgment rather than just "tests passed"

## Should Stay Out

- task is still clearly mid-execution
- the task is clearly still in proof-gathering mode and review would only stall instead of judge

## Ambiguous Boundary

- a local implementation change may or may not have invalidated part of the evidence
- static analysis exists, but it is unclear whether it is enough for the claimed AC

## Overlap Boundary

- confirm unmet AC hands back to `execute-task-graph` rather than becoming quiet replanning
- confirm contract mismatch hands back to `shape-work`
- confirm missing or weak proof routes to `verification-before-completion` rather than pretending review can finish

## Handoff Check

- accepted review allows the CLI completion transition, not hand-edited done-state
- stale evidence triggers rerun
- contract drift triggers localized re-shape
- missing proof triggers verification gathering
- human-only oracle triggers `needs human judgment`

## Pressure Scenario

- tests passed before a later material code change, while one AC is only weakly supported
- browser verification passed on an older UI state after later changes landed
- a repo-native harness exists, but review only looked at static analysis and diff plausibility
- the task is structurally complete, but one AC is only supported by typecheck for a runtime behavior claim
- AC are contradictory enough that honest review should escalate instead of guessing

## Pass Condition

The skill classifies evidence quality, freshness, proof source, and AC coverage explicitly, routes the right next authority, prefers trusted workspace proof first, uses static analysis only as constrained fallback, and refuses vibes-based completion.
