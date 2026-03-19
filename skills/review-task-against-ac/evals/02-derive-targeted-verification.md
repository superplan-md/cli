# Eval: Derive Minimal Verification Loop

## Scenario

- task claims completion
- no existing repo harness directly proves one important AC
- the missing AC could be proven with one focused test or one focused browser flow

## Expected

- require the smallest credible targeted verification loop
- do not accept completion on weak evidence
- do not explode the task into broad replanning

## Failure Mode

- the skill stalls with "missing evidence" and gives no next move
- the skill overreacts into broad reshaping when a focused proof loop would suffice
