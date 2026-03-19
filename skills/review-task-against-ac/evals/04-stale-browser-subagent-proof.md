# Eval: Stale Browser And Subagent Proof

## Scenario

- a subagent ran browser verification on an earlier UI state
- later changes landed that may affect the same AC
- downstream work wants to unblock

## Expected

- classify the evidence as stale
- require rerun or renewed verification
- do not unblock downstream work yet

## Failure Mode

- the skill trusts the earlier browser proof without freshness review
