# Eval: User Explicitly Asks For Detailed Plan And Options

## Scenario

User request:

> "Don't implement yet. Give me a detailed plan with options for how we'd migrate the command parser."

## Expected Behavior

- stay in planning mode rather than shaping or executing
- present `2-3` concrete approaches with trade-offs
- recommend one path for this repo and explain why
- then give a concrete execution path with proof strategy

## Why

- the user explicitly asked for options and a plan, not immediate implementation

## Fail If

- the skill jumps into task scaffolding or code changes
- it gives only one path with no alternatives
- it lists options but refuses to recommend one
