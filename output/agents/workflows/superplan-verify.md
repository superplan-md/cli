---
name: superplan-verify
description: Use when you are about to say work is complete, fixed, passing, or ready and need fresh proof from the real workspace harness first.
---

# Verification Before Completion

## Overview

Do not claim success without evidence.

This is the generic discipline gate that runs before completion claims.
It is not the same as Superplan's final AC review, but it feeds that review.

## Gate Law

No claim of complete, fixed, passing, or ready for handoff without running the relevant proof first.

## Hard Gate

Do not use confidence, code inspection, or stale output as a substitute for fresh verification evidence.

## Trigger

Use when:

- the agent is about to say a task is complete, fixed, passing, or ready
- fresh evidence must be gathered from the current workspace harness
- output confidence is starting to outrun proof

## Core Rules

- run the relevant checks before making success claims
- prefer the repo's trusted scripts, custom skills, browser flows, and QA routines
- if no existing trusted path proves the AC directly, derive the smallest credible verification loop that does
- map verification to the actual acceptance criteria
- distinguish strong proof from weak supporting evidence
- use static analysis only as a constrained fallback when stronger proof is unavailable or disproportionate
- surface stale, missing, or partial evidence honestly
- hand results cleanly to `superplan-review` when tracked task completion is at stake

## Forbidden Behavior

- saying "should be fixed" without running anything
- running checks that do not actually prove the acceptance criteria
- treating stale evidence as current proof
- using a Superplan-specific path when the repo already has a better trusted one
- treating static analysis as full proof for runtime or user-visible behavior when stronger proof is realistically available

## Handoff

For tracked tasks, verification hands into `superplan-review`.
For non-tracked work, it still governs whether any success claim is honest.
