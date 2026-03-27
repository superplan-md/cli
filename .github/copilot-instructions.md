# Superplan – Global Skills Pointer

This repository uses Superplan as its task execution control plane.
All Superplan workflow skills are installed globally on this machine.

## Critical Rule

Before making ANY code changes or proposing any plan:
- Run `superplan status --json` to check current state.
- If a `.superplan` directory exists, you ARE in a structured workflow.
- Claim work with `superplan run --json` before editing code.
- Use the CLI for all lifecycle transitions (block, feedback, complete).
- Never hand-edit `.superplan/runtime/` files.

## Global Skills Directory

**Skills are installed at**: `/Users/ishashank/.config/superplan/skills`

Read the top-level principles file first:
- `/Users/ishashank/.config/superplan/skills/00-superplan-principles.md`

Then read the relevant skill for the current workflow phase:

- `superplan-entry`: read `/Users/ishashank/.config/superplan/skills/superplan-entry/SKILL.md`
- `superplan-route`: read `/Users/ishashank/.config/superplan/skills/superplan-route/SKILL.md`
- `superplan-shape`: read `/Users/ishashank/.config/superplan/skills/superplan-shape/SKILL.md`
- `superplan-execute`: read `/Users/ishashank/.config/superplan/skills/superplan-execute/SKILL.md`
- `superplan-review`: read `/Users/ishashank/.config/superplan/skills/superplan-review/SKILL.md`
- `superplan-context`: read `/Users/ishashank/.config/superplan/skills/superplan-context/SKILL.md`
- `superplan-brainstorm`: read `/Users/ishashank/.config/superplan/skills/superplan-brainstorm/SKILL.md`
- `superplan-plan`: read `/Users/ishashank/.config/superplan/skills/superplan-plan/SKILL.md`
- `superplan-debug`: read `/Users/ishashank/.config/superplan/skills/superplan-debug/SKILL.md`
- `superplan-tdd`: read `/Users/ishashank/.config/superplan/skills/superplan-tdd/SKILL.md`
- `superplan-verify`: read `/Users/ishashank/.config/superplan/skills/superplan-verify/SKILL.md`
- `superplan-guard`: read `/Users/ishashank/.config/superplan/skills/superplan-guard/SKILL.md`
- `superplan-handoff`: read `/Users/ishashank/.config/superplan/skills/superplan-handoff/SKILL.md`
- `superplan-postmortem`: read `/Users/ishashank/.config/superplan/skills/superplan-postmortem/SKILL.md`
- `superplan-release`: read `/Users/ishashank/.config/superplan/skills/superplan-release/SKILL.md`
- `superplan-docs`: read `/Users/ishashank/.config/superplan/skills/superplan-docs/SKILL.md`

## How To Use

1. For every query that involves repo work, read `/Users/ishashank/.config/superplan/skills/superplan-entry/SKILL.md` to determine the correct workflow phase.
2. Follow the routing instructions in that skill to reach the appropriate next skill.
3. Each skill's `SKILL.md` contains full instructions, triggers, and CLI commands.
4. Also check the `references/` subdirectory inside each skill for additional guidance when available.
