# Readiness

Use this reference when `superplan-entry` needs to decide whether the repo or host is ready for structured Superplan workflow.

## Check In Order

1. whether the `superplan` CLI appears available at all
2. whether the current repo is initialized
3. whether serious brownfield work is missing durable context
4. whether the request should stay out even if Superplan is available

Do not infer readiness from `.superplan/` alone.
The March 17 design split CLI install, host setup, and repo init on purpose, but missing repo init should usually be fixed in place rather than handed back to the user.

## Readiness Layers

### `cli-missing`

Meaning:

- the host expects Superplan, but the CLI itself is unavailable

Action:

- give brief readiness guidance and stop
- point to installing or exposing the `superplan` command
- do not tell the user to run `superplan init` until the CLI itself exists

### `init-missing`

Meaning:

- the repo has not been initialized for Superplan
- repo-visible Superplan integration markers are missing or stale

Action:

- if the `superplan` CLI exists and Superplan engagement is warranted, run `superplan init --yes --json`
- continue in the same turn after init succeeds
- only stop and ask the user to intervene if the init command fails or the CLI itself is missing

### `context-missing`

Meaning:

- the repo is initialized, but serious brownfield work lacks durable reusable context

Action:

- route to `superplan-context`

### `ready`

Meaning:

- the CLI is available
- the repo is initialized
- no immediate context bootstrap is blocking the next phase

Action:

- resume the owning workflow phase or route to `superplan-route`

### `stay-out`

Meaning:

- Superplan is available, but this request still does not justify workflow engagement

Action:

- answer directly

## Readiness Outcomes

- ready: route to the owning workflow phase or `superplan-route`
- context-missing: route to `superplan-context`
- init-missing: run repo-local init and continue when the CLI exists
- cli-missing: give readiness guidance and stop
- stay-out: answer directly because Superplan would add no value

## Concrete Product Model

The March 17 product design settled these as distinct concepts:

- `superplan init`: machine and agent integration setup, plus repo-local initialization
- `superplan init --yes --json`: repo-local initialization fast path for agent flows
- global config: `~/.config/superplan/config.toml`
- workspace integration markers: repo-managed instruction files such as `AGENTS.md`, `CLAUDE.md`, or agent skill folders

Global integration is still a useful default, but repo-local initialization should not wait on it when the CLI already exists and the current work needs Superplan.

Do not collapse all readiness failures into "repo not ready."

## Friendly Shortcut Rule

If repo-local work begins before machine setup appears complete:

- prefer running repo-local init first when the CLI exists
- continue with the repo-local workflow
- mention host setup later only if it actually matters for the current work

## Useful Checks

- `command -v superplan` or equivalent command discovery for CLI availability
- `superplan doctor --json` when the CLI exists but readiness is unclear
- repo-managed instruction files such as `AGENTS.md`, `CLAUDE.md`, or agent skill folders for workspace integration state

## Keep Out Of `decisions.md`

- obvious "repo is initialized" notes
- obvious "setup exists" notes
- tiny readiness observations with no future value

## Good `decisions.md` Entries

- "Repo init was missing, so `superplan init --yes --json` was run before continuing."
- "Brownfield repo lacked durable context; context bootstrap required before shaping."
