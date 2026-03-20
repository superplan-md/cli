---
name: regression-guarding
description: Use when a behavior changed or a bug was fixed and the agent should add the smallest durable guard so it does not silently regress.
---

# Regression Guarding

## Overview

Every important fix or behavior change should leave behind a guard.

## Trigger

Use when:

- a bug was fixed
- a workflow contract changed
- the agent asks "what test should protect this?"
- a failure revealed a missing proof path

## Core Rules

- identify the exact behavior worth protecting
- add the smallest credible guard that would fail before the bug returns
- prefer the repo's existing test or verification style
- guard the contract, not the incidental implementation
- keep the guard close to the changed behavior when possible

## Forbidden Behavior

- adding broad noisy tests when one focused check would do
- testing implementation trivia instead of user-visible or contract-visible behavior
- skipping the guard because the fix feels obvious

## Handoff

Likely follow-ons:

- `test-driven-development` when the guard should be written before the full fix
- `verification-before-completion` when the new guard becomes part of the proof path
- `retrospective-postmortem` when the missing guard revealed a broader process gap
