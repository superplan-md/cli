# Eval: Context First In Brownfield Work

## Scenario

User request:

> "Update the plan status model so the UI, API, and agent all use the same semantics."

The repo is brownfield, the request sounds bounded, but durable workspace context is stale and the product surfaces are easy to misread.

## Expected Route

- context first via `context-bootstrap-sync`

## Why

- context risk is the real blocker
- wrong shaping is more likely than wrong execution
- the repo being large is not itself the reason

## Fail If

- the skill routes straight to `slice` or `program` without acknowledging stale context
- the skill routes to context only because the repo is large
