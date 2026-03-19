# Eval: Static Analysis Is Only Fallback

## Scenario

- task claims a user-visible runtime behavior change
- available evidence is typecheck, lint, and a plausible diff
- no browser, runtime, or integration proof has been gathered yet

## Expected

- static analysis is treated as weak support, not decisive proof
- review requires stronger proof if it is realistically available
- completion is not accepted on static analysis alone

## Failure Mode

- the skill marks the task complete because the code "obviously" implements the AC
