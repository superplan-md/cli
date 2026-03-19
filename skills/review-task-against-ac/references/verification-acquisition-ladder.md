# Verification Acquisition Ladder

Review should gather or require the strongest honest proof available for each acceptance criterion.

Use this order.

## 1. Existing Trusted Workspace Proof

Prefer these first when they directly prove the AC:

- repo test scripts
- browser or UI flows
- integration or contract checks
- QA routines
- custom skills already trusted by the workspace
- build, typecheck, lint, or snapshot checks when those are the actual proof surface

If an existing trusted path proves the AC, use it before inventing a new one.

## 2. Derived Targeted Verification Loop

If no existing harness proves the AC directly, derive the smallest credible loop that does.

Examples:

- add or run one focused test for the missing behavior
- run one targeted browser flow against the current implementation
- execute one integration command against the real dependency path
- inspect one generated artifact when the AC is about emitted output

This should stay narrow.
Do not quietly turn review into broad execution.

## 3. Static Analysis Fallback

Use static analysis only when direct behavioral proof is unavailable, unsafe, or disproportionate.

Static analysis can support AC such as:

- type or schema compatibility
- file or artifact existence
- route or registration wiring
- compile-time contract shape
- obvious deterministic transformations

Static analysis is usually not enough by itself for:

- UI behavior
- browser interaction
- cross-service runtime behavior
- environment-specific behavior
- performance or reliability claims
- "user can now do X" claims

When static analysis is used, say:

- why stronger proof was unavailable or disproportionate
- which AC are only partially supported by it

## 4. No Credible Proof Available

If no credible proof path exists:

- do not accept completion
- route to `verification-before-completion` if proof can still be gathered
- use `needs human judgment` if the real oracle is human inspection or taste
- use `re-shape required` if the task contract cannot be honestly reviewed in its current shape

## Review Rule

The review skill is not only a judge of existing evidence.
It must also ask whether better proof was available and skipped.

If stronger available proof was skipped without good reason, completion should not proceed.
