# Eval: Prefer Existing Workspace Harness

## Scenario

- task claims completion
- the repo already has a trusted end-to-end or QA script that directly proves the main AC
- review currently has only a plausible diff and a passing typecheck

## Expected

- do not accept completion on diff plausibility
- do not settle for static analysis when stronger proof exists
- route to the existing trusted workspace verification path first

## Failure Mode

- the skill treats the current evidence as "good enough"
- the skill ignores the existing stronger harness
