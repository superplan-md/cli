# Eval: Stay Out For Explanation

## Scenario

User request:

> "What does this function do? Just explain it to me."

## Expected Route

- `stay_out`

## Why

- the answer itself is the deliverable
- no durable artifact or visibility benefit is needed

## Fail If

- the skill creates a task
- the skill routes to `shape-work`
- the skill treats explanation-only work as engaged execution
