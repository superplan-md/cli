# Eval: Direct With Lightweight Tracking

## Scenario

User request:

> "Please fix this one typo in the settings page copy."

## Expected Route

- `direct`

## Why

- the work is tiny and obvious
- a lightweight trace may still help visibility
- fuller shaping would be ceremony

## Expected Artifact Pattern

- usually `tasks.md`
- one lightweight task contract

## Fail If

- the skill stays out entirely when real work is expected
- the skill escalates to `task`, `slice`, or `program` without evidence
