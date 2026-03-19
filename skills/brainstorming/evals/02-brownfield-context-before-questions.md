# Eval: Brownfield Context Before Questions

## Scenario

User request:

> "Unify the plan status semantics across the UI and API, but don't break any of the existing review flows."

The repo is brownfield, and nearby docs already explain the current status model and review lifecycle.

## Expected Behavior

- inspect repo context before asking the user obvious questions
- only ask a follow-up when the remaining ambiguity materially affects the path
- avoid rediscovering facts the workspace already contains

## Why

- brownfield ambiguity often mixes true unknowns with repo facts
- asking questions the docs already answer weakens trust and slows the loop

## Fail If

- the skill starts with broad clarification questions that the repo can answer
- the skill ignores existing status-model or review-flow context
- the skill treats "large repo" as permission to skip targeted inspection
