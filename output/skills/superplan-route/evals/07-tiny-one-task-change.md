# Eval: Tiny One-Task Change

## Scenario

User request:

> "Update the `run` help text and the install-helper guidance so both mention `--fresh`."

The request is tiny, but it touches more than one small surface and the user expects a real repo change rather than an explanation.

## Expected Route

- `direct`

## Why

- it is still one bounded executable unit
- lightweight tracking preserves visibility without forcing planning ceremony
- it is not small enough for `stay_out`, and not broad enough for `task`, `slice`, or `program`

## Expected Artifact Pattern

- one lightweight tracked task
- likely via the single-task fast path once shaping starts

## Fail If

- the skill stays out because the change sounds small
- the skill escalates to `task`, `slice`, or `program`
- the skill treats two tiny surfaces as proof that deeper decomposition is needed
