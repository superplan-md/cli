# Entry Discipline

`superplan-entry` is not just a trigger router.

It is the outer workflow governor for Superplan.

## Core Rule

Before doing workflow work, decide three things in order:

1. should Superplan stay out
2. is readiness missing
3. which workflow phase owns the next responsibility

Do not jump straight to planning or execution just because the repo work sounds substantial.

## Subagent Guard

If you were dispatched as a bounded subagent for a specific task, investigation, or verification surface, skip top-level entry routing.

Why:

- the outer workflow layer already ran
- rerunning it inside a subagent causes duplicate routing and phase drift
- bounded execution should stay owned by the assigned phase

## Instruction Priority

Honor this order:

1. direct user instructions
2. repo instructions such as `AGENTS.md`, `CLAUDE.md`, or host-local guidance
3. `superplan-entry`
4. generic defaults

This skill governs workflow entry.
It does not override the user's repo contract.

## Process-First Rule

Do not choose a support discipline as the first entry lane.

Wrong:

- "This sounds ambiguous, so go straight to `superplan-brainstorm`."
- "This is a bug, so go straight to `superplan-debug`."

Right:

- decide which workflow phase owns the moment
- let that workflow phase invoke the discipline it needs

## Communication Rule

Keep that workflow choice internal unless the user explicitly asks for it.

User updates should describe:

- the concrete repo change underway
- the risk or uncertainty being checked
- the user-visible consequence of the next step

User updates should not describe:

- which Superplan skill is active
- that routing or shaping is happening
- raw explored-file or command logs unless the user asked for them

## Red Flags

These thoughts usually mean the entry layer is being skipped or weakened:

- "This is obvious, I can just start."
- "I only need to glance at one file first."
- "It is probably superplan-route."
- "The user said bug, so debugging comes first."
- "The user said done, so completion review can wait."
- "The message is short, so I should reroute from scratch."

## Direct Resume Hints

The entry layer should resume later phases when the work is already shaped.

Strong execution signals:

- "continue"
- "resume"
- "pick the next task"
- explicit task IDs
- existing parsed tasks or runtime state already indicate tracked work

Strong completion-review signals:

- "is this done"
- "can this unblock"
- "review against AC"
- "should we mark this complete"

Do not force those requests back through `superplan-route` unless the structure itself is now in doubt.
