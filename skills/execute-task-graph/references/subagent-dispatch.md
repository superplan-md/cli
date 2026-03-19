# Subagent Dispatch

Use subagents aggressively only when ownership and assumptions are bounded.

## Good Patterns

- branch parallelism on disjoint write surfaces
- worker plus verifier when the contract is stable enough
- blocker investigation while other safe ready work continues
- review shadowing for AC gap detection

## Pattern Selection

Choose:

- branch parallelism when multiple ready tasks are independent
- worker plus verifier when verification can run without a moving-target problem
- blocker investigation when one uncertainty should not stall other safe ready work
- review shadowing when evidence quality is the main risk

## Bad Patterns

- parallel work on unstable shared assumptions
- verifier running against a moving target with no rerun plan
- workers redefining task contracts silently
- parallel work whose integration cost likely exceeds the speed gain
- workers with overlapping ownership or unclear write surfaces

## Required Dispatch Clarity

- owned task or write surface
- stable assumptions the worker may rely on
- expected output
- verification expectation
- handoff condition
- integration note if parallel work must merge back together
- rerun plan when verifier results may go stale
