# Memory And Measurement

Use this reference when entry routing needs to decide what durable workflow memory should be recorded and what should eventually be measured.

## Current Durable Surfaces

- `.superplan/decisions.md` for meaningful route or readiness decisions future agents must understand
- `.superplan/gotchas.md` for repeated traps and misleading defaults
- `.superplan/context/` for durable repo truth that later workflow phases rely on

## Keep The Boundaries Clean

- config stores durable defaults and saved preferences
- `decisions.md` stores meaningful decisions, not routine observations
- `gotchas.md` stores repeated traps, not one-off surprises

## Skill-Specific Vs Workspace-Wide

- skill-specific trap: entry-routing or readiness judgment failure tied to `using-superplan`
- workspace-wide trap: recurring repo or product issue that future agents across skills need to know

Workspace-wide traps belong in `.superplan/gotchas.md`.

## Future Stable Data Conventions

The March 19 design calls for stable storage over time for:

- prior routing choices
- prior interruption answers
- prior verification outcomes or reports
- prior task-review decisions
- trigger telemetry

If the product has not settled those surfaces yet, do not invent one-off files during entry routing.

## Minimum Measurement Plan

At minimum, the design should eventually track:

- skill trigger counts
- stay-out counts
- user interruption points
- late review failures
- localized re-shape frequency
- strategic re-route frequency

## Entry-Layer Guidance

- only write durable memory when it will help a future agent make a better routing or readiness decision
- keep tiny readiness observations out of `decisions.md`
- if measurement surfaces are not implemented yet, keep the contract visible in docs rather than fabricating fake telemetry
