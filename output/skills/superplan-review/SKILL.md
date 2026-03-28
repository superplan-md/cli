---
name: superplan-review
description: Use when a Superplan task claims completion or downstream work depends on verifying its acceptance criteria and completion evidence.
---

# Review Task Against AC

## Overview

Decide whether a task is actually complete against its contract.

This is the Superplan-specific completion gate.
It must judge completion against the task contract, acceptance criteria, and fresh evidence rather than vibes or implementation plausibility.

## Trigger

Use when:

- a task is claimed ready for completion
- downstream work may unblock if the task is truly done
- verification has run and the system must decide whether the results are still valid
- subagents have produced evidence that appears sufficient

## Stay Out

Do not review when:

- the task is clearly mid-execution
- key evidence is still missing
- the task contract is too broken to review cleanly
- the verification basis is obviously stale and must be rerun first
- structural trajectory change invalidated the review target

## Inputs And Assumptions

Inputs:

- task contract
- acceptance criteria
- implementation evidence
- verification outputs
- outputs from trusted workspace-native harnesses or QA flows
- available repo-native scripts, custom skills, browser flows, QA routines, and contract checks
- runtime notes and recent trajectory changes
- subagent outputs and ownership boundaries where relevant
- chosen verification plan when available
- recent decision log entries affecting contract interpretation
- known gotchas that may invalidate naive review

Assumptions:

- completion must be judged against the task contract
- evidence can become stale after material implementation or trajectory change
- not all evidence is equal
- the strongest honest proof should come from an existing trusted workspace harness when possible
- if no existing harness proves the AC directly, review should require the smallest credible verification loop that does
- static analysis is a constrained fallback, not a default completion oracle

## Verification Acquisition Ladder

When evidence is weak, missing, or only partially relevant, use this order:

1. Reuse an existing trusted workspace-native proof path.
   Examples:
   - repo test or QA scripts
   - browser or UI validation flows
   - custom skills
   - integration or contract checks

2. If no existing path proves the AC directly, derive the smallest credible verification loop.
   Examples:
   - add or run one targeted test for the missing AC
   - run one browser flow against the current implementation
   - run one focused integration command against the real dependency surface

3. Use static analysis only when direct behavioral proof is unavailable, unsafe, or disproportionate.
   Static analysis can support AC such as:
   - schema or interface shape
   - file or artifact presence
   - wiring or registration
   - type-level guarantees
   - obvious deterministic data transformation logic

4. If no credible proof path exists, do not bless completion.
   Route to:
   - `superplan-verify` when proof can still be gathered
   - `needs human judgment` when the real oracle is human inspection or taste
   - `re-shape required` when the contract is no longer honestly reviewable

Static analysis is usually not enough by itself for AC about:

- user-visible runtime behavior
- browser or UI interaction
- cross-service integration
- environment-specific behavior
- performance or reliability claims

See `references/verification-acquisition-ladder.md`.

## Evidence Validity Model

Classify evidence before trusting it:

- strong valid evidence: directly covers the claimed AC and targets the current implementation
- weak but useful evidence: supports the judgment but cannot prove important AC alone
- stale evidence: verification predates material changes or earlier task understanding
- invalid evidence: unrelated, mis-targeted, or based on false assumptions

See `references/evidence-validity.md` and `references/stale-verification.md`.

## Trajectory-Aware Review Rules

- local execution change: review may continue, rerunning only invalidated checks
- structural trajectory change: do not bless the task as-is; require localized re-shape or reconciliation
- strategic trajectory change: stop pretending the old AC are sufficient

## CLI Alignment Now

Current CLI reality:

- review is still a workflow judgment, not a persisted runtime state
- completion should still flow through the CLI transition rather than markdown edits

Therefore:

- accepted review should hand into the normal CLI completion transition for the task
- do not hand-edit task status to `done`
- do not treat review acceptance as equivalent to already-completed runtime state

## Allowed Actions

- evaluate each acceptance criterion
- inspect evidence provenance, freshness, and relevance
- reconcile subagent-produced evidence against the final task contract
- map each AC to its strongest available proof source
- run or require relevant verification
- prefer the repo's trusted verification path when more proof is needed
- derive the smallest credible verification loop when no trusted existing path proves an AC directly
- use static analysis only as a constrained fallback and say why stronger proof was unavailable or disproportionate
- require reruns when evidence is stale
- reject completion when the contract changed materially
- decide:
  - `accepted`
  - `rejected`
  - `incomplete`
  - `rerun required`
  - `re-shape required`
  - `needs human judgment`
- identify which AC are unmet or only weakly supported
- identify which proof source supports each AC
- identify which AC still need stronger proof than static analysis or plausibility
- identify which checks must rerun before honest completion is possible
- identify which review outcome should be recorded as a durable decision
- identify whether a new gotcha was discovered during review

## Forbidden Behavior

- treating Superplan-originated evidence as inherently better than valid workspace-native evidence
- requiring a Superplan-specific verification path when the workspace already has a trustworthy one
- broad replanning
- silently changing the task contract to fit work already done
- marking tasks complete on vibes
- unblocking downstream work without real review
- treating any passing test as universal proof
- treating build, lint, or typecheck as proof of runtime behavior without AC-specific justification
- treating a plausible diff as completion proof when a real verification loop was available
- using static analysis as the sole proof for UI, integration, or runtime-behavior AC without explicit justification
- staying in review mode while missing proof when the right next move is to gather verification
- trusting stale evidence after material changes
- hand-editing task status or completion state instead of routing through the CLI completion transition

## Outputs

Expected output categories:

- accepted as complete
- rejected: unmet AC
- incomplete: missing evidence
- rerun required: stale evidence
- localized re-shape required
- needs human judgment

The output should identify:

- each acceptance criterion
- its current status
- proof source for that AC
- evidence class for that AC
- whether verification is fresh enough
- whether stronger proof was available but not yet gathered
- which checks must rerun or run first
- whether static analysis fallback was used and why
- whether downstream unblocking is safe
- whether the next move is the CLI completion transition or more work first

## Completion Authority

Allow completion only when all of the following hold:

- the task contract still describes the actual work being judged
- the relevant acceptance criteria are satisfied
- the strongest available proof has been gathered or reused honestly
- no stale evidence remains on critical AC
- no unresolved blockers remain inside the task contract

If stronger available proof was skipped without good reason, completion should not proceed.

## Decision And Gotcha Rules

Use `.superplan/decisions.md` for material review judgments that affect downstream work, such as acceptance, rejection, rerun requirements, or contract mismatch findings that future agents need to know.

Do not log every trivial successful review.

Use `.superplan/gotchas.md` for recurring review failures, stale-evidence traps, misleading verification signals, and repo-specific proof pitfalls likely to recur.

See `references/gotchas.md`.

## Handoff

Likely handoffs:

- to `superplan-verify` when key proof is missing, weak, or stale but the task is still reviewable
- back to `superplan-execute` for more work when AC are unmet after honest review
- task completion through the normal CLI completion transition if accepted:
  - current CLI: `superplan task review complete <task_ref> --json`
- user feedback if human judgment is needed
- back to `superplan-shape` when the task contract no longer matches the real work

Internal support-skill usage may include:

- `superplan-verify`

## Validation Cases

Should reject:

- tests pass but explicit AC remain unmet
- implementation exists but no evidence supports claimed behavior
- required docs, tests, or outputs are missing
- static analysis is the only proof for a user-visible runtime AC even though a stronger proof path was available

Should accept:

- all required AC are satisfied
- relevant verification is complete
- evidence is fresh enough for the current implementation and contract
- the proof source for each critical AC is strong enough for the kind of claim being made

Should require rerun:

- verification predates material changes
- verification targeted the wrong environment or branch
- a stronger repo-native verification path exists but has not yet been run for the current implementation

Should route to verification gathering first:

- key evidence is missing but a credible repo-native or targeted verification loop still exists
- the current proof is only diff plausibility or static analysis for a behavior AC
- subagent evidence is promising but incomplete

Should require localized re-shape:

- the task contract no longer matches the real implementation path
- a hidden dependency changed what done should mean
- the AC cannot be honestly proven with the current task boundary and should split or reconcile
