# Eval: Task For One Bounded Bugfix

## Scenario

User request:

> "Fix the bug where archived projects still appear in the search results."

The bug is contained to one backend service and has clear acceptance criteria.

## Expected Route

- `task`

## Why

- one bounded, reviewable unit is enough
- graph structure is not the main coordination problem

## Expected Artifact Pattern

- `tasks.md`
- one normal task contract

## Fail If

- the skill chooses `direct` and loses normal task discipline
- the skill chooses `slice` without real sequencing or decomposition pressure
