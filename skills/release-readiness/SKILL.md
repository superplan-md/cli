---
name: release-readiness
description: Use when the user asks whether something is ready to ship, publish, or recommend as production-ready and a disciplined release check is needed.
---

# Release Readiness

## Overview

Decide whether the current product slice is honestly ready to ship.

## Trigger

Use when:

- the user asks "is this prod ready?"
- a release, publish, or rollout decision is being made
- the repo needs one last quality gate before recommending adoption

## Core Rules

- run the strongest relevant verification path first
- prefer full-suite or release-equivalent checks when they exist
- include install, update, docs, and help-surface sanity checks when they affect real users
- distinguish "ready for this scope" from "ready for every future direction"
- name blockers plainly when the answer is no

## Minimal Checklist

- build and test status
- runtime and doctor health
- install and update story
- user-facing docs/help alignment
- known high-risk gaps or unresolved failures

## Forbidden Behavior

- calling something production-ready on partial proof
- hiding failures because they seem small
- widening the claimed scope beyond what was actually verified

## Handoff

Likely follow-ons:

- `verification-before-completion` for missing proof
- `docs-sync` for stale release docs
- `execute-task-graph` for the concrete blocker fixes
