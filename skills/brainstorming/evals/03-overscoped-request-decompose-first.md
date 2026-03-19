# Eval: Overscoped Request Decomposes First

## Scenario

User request:

> "Build a polished collaboration system with shared boards, agent handoff history, billing, notifications, and an admin console."

## Expected Behavior

- identify that the request spans multiple independent systems
- decompose into smaller designable units or slices
- choose the best first slice to design before asking detailed implementation questions

## Why

- one clean design cannot safely cover multiple major systems at once
- pretending otherwise creates fake clarity

## Fail If

- the skill treats the whole request as one bounded design target
- the skill starts refining low-level details before decomposing the work
- the skill writes one oversized spec as if it solved the overscope problem
