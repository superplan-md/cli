# Eval: Slice For Bounded Multi-Step Work

## Scenario

User request:

> "Add CSV export for invoices. It needs one backend endpoint, a download button in the app, and basic audit logging."

The work is bounded, but sequencing across a few dependent steps matters.

## Expected Route

- `slice`

## Why

- the work is multi-step but still bounded
- one workstream needs planning and a small task graph
- richer program structure would be overkill

## Expected Artifact Pattern

- usually `plan.md`
- `tasks.md`
- `tasks/T-*.md`

## Fail If

- the skill collapses this to one `task`
- the skill jumps to `program` because multiple surfaces are involved
