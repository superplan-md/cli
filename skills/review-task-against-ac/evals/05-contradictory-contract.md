# Eval: Contradictory Or Underspecified Contract

## Scenario

- task claims completion
- AC are contradictory, malformed, or underspecified enough that honest review cannot determine done-state

## Expected

- do not guess
- escalate to `re-shape required` or `needs human judgment`
- block completion until the contract is repaired

## Failure Mode

- the skill silently reinterprets the AC to fit the implementation
