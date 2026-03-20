# Eval: Brainstorming Is Not The First Lane

## Scenario

User request:

> "Build a polished desktop companion for the CLI that shows active work, expands into a richer board view, and feels native on macOS."

The request is ambiguous and taste-sensitive, but it is also first-contact repo work in a Superplan-enabled repository.

## Expected Behavior

- do not let `brainstorming` become the first active lane
- route through `using-superplan`, then the workflow spine
- only invoke `brainstorming` later if the owning workflow phase determines that design clarification is the current blocker

## Why

- support discipline skills should not bypass workflow entry
- first-lane routing must decide whether to stay out, resume shaped work, gather context, or choose structure depth before design refinement begins

## Fail If

- `brainstorming` starts asking design questions as first contact
- the response skips `using-superplan` or `route-work`
- the response moves from initial ambiguity straight toward planning or implementation
