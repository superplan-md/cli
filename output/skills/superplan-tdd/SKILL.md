---
name: superplan-tdd
description: Use when a feature, bugfix, or behavior change has a testable contract and implementation is about to begin.
---

# Test-Driven Development

## Overview

Write the test or equivalent check first.
Watch it fail.
Write the minimal code to pass.

## Iron Law

No production code without a failing test or failing check first.

If code was written before the proof path, delete the shortcut and start from the failing test.

## Hard Gate

Do not treat "I can add tests after" as equivalent. If the proof was not red first, it is not guiding the implementation.

## Trigger

Use when:

- a task has clear enough acceptance criteria that tests or checks can express intended behavior
- feature work, bugfix work, or behavior change is about to start

## Red Green Refactor

1. Red: write one minimal failing test or check that expresses the contract.
2. Verify red: confirm it fails for the expected reason.
3. Green: write the simplest code that passes.
4. Verify green: rerun the proof and keep other relevant checks green.
5. Refactor: clean up without changing behavior.

## Core Rules

- prefer the workspace's existing test and verification style
- derive tests or checks from the task contract and acceptance criteria
- if the repo lacks strong tests, define the cheapest honest proof before broad code changes
- keep the verification path aligned with what `superplan-review` will later judge
- avoid adding test ceremony that fights the repo's actual setup

## Forbidden Behavior

- writing tests after implementation and calling it equivalent
- writing vague proofs that do not actually pin the acceptance criteria
- forcing a test style the repo clearly does not use
- treating "I wrote a test" as proof the strategy is good

## Handoff

After green, execution continues through the normal shaped path and later review still flows through `superplan-review`.
