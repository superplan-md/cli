# Evidence Validity

Review trusts evidence only after classifying it.

## Strong Valid Evidence

- directly covers the claimed AC
- targets the current implementation and environment
- ran after the final material change

Examples:

- tests or checks that directly prove the AC
- browser verification against the current UI state
- build, typecheck, lint, snapshot, or contract checks run after the final material change

Effect:

- can support completion when AC coverage is sufficient

## Weak But Useful Evidence

- plausible diff
- partial logs or screenshots
- exploratory manual notes

Useful for support, not decisive proof for important AC.

Examples:

- implementation diff looks plausible
- verifier commentary without decisive proof
- one partial log for a multi-step AC

Effect:

- can support judgment
- cannot alone justify completion for important or user-visible AC

## Stale Evidence

- verification predates material code changes
- subagent verified an earlier understanding of the task
- dependency assumptions changed after verification

Effect:

- should trigger rerun, reconciliation, or rejection depending on impact

## Invalid Evidence

- unrelated to the AC
- wrong environment or task
- based on assumptions now known false

Effect:

- should not be used for completion

## Static Analysis Classification

Static analysis is usually:

- strong only for structural AC it directly proves
- weak for behavioral AC
- invalid when it does not actually touch the claimed outcome

Examples:

- typecheck proving a TypeScript type contract: may be strong
- lint proving user-visible runtime behavior: weak or invalid
- code diff proving an end-to-end UI flow: weak
