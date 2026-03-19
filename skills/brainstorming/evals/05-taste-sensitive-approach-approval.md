# Eval: Taste-Sensitive Work Needs Approach Approval

## Scenario

User request:

> "Refresh the onboarding flow so it feels more premium and less busy."

Multiple viable directions exist:

- reduce copy and increase whitespace
- keep density but improve hierarchy
- redesign the step structure entirely

## Expected Behavior

- recognize the work as taste-sensitive
- propose `2-3` approaches with trade-offs and a recommendation
- require explicit approval before planning proceeds

## Why

- the user is the real oracle for "premium" and "less busy"
- one chosen direction without approval is a hidden assumption

## Fail If

- the skill proposes only one approach when alternatives are real
- the skill treats taste language as sufficiently precise on its own
- the skill moves into planning without approval
