# Readiness

Use this reference when `superplan-entry` needs to decide whether the repo or host is ready for structured Superplan workflow.

## Check In Order

1. whether the `superplan` CLI appears available at all
2. whether machine or agent integration setup appears present
3. whether the current repo is initialized
4. whether serious brownfield work is missing durable context
5. whether the request should stay out even if Superplan is available

Do not infer readiness from `.superplan/` alone.
The March 17 design split CLI install, host setup, and repo init on purpose.

## Readiness Layers

### `cli-missing`

Meaning:

- the host expects Superplan, but the CLI itself is unavailable

Action:

- give brief readiness guidance and stop
- point to installing or exposing the `superplan` command
- do not tell the user to run `superplan setup` until the CLI itself exists

### `setup-missing`

Meaning:

- the CLI may exist, but machine or agent integration setup is missing
- the user is not yet in the normal Superplan-capable host state

Action:

- guide the user to `superplan setup`
- stop rather than pretending the workflow is ready
- prefer the global host integration path unless the user explicitly wants local-only setup

### `init-missing`

Meaning:

- the repo has not been initialized for Superplan
- `.superplan/config.toml` or equivalent repo-local initialization markers are missing

Action:

- guide the user to `superplan init --json`
- if setup also appears missing, call that out first
- if the user started with `init`, explain the shortcut flow: `setup` first, then `init --json`

### `context-missing`

Meaning:

- the repo is initialized, but serious brownfield work lacks durable reusable context

Action:

- route to `superplan-context`

### `ready`

Meaning:

- the CLI is available
- setup appears present
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
- init-missing: give readiness guidance and stop
- setup-missing: give readiness guidance and stop
- cli-missing: give readiness guidance and stop
- stay-out: answer directly because Superplan would add no value

## Concrete Product Model

The March 17 product design settled these as distinct concepts:

- `superplan setup`: machine and agent integration setup
- `superplan init --json`: repo-local initialization
- global config: `~/.config/superplan/config.toml`
- workspace config: `<repo>/.superplan/config.toml`

Global integration is the default path.

Do not collapse all readiness failures into "repo not ready."

## Friendly Shortcut Rule

If repo-local work begins before machine setup appears complete:

- call out that `setup` is missing
- then call out `init` if the repo also needs initialization

The user should understand which layer is missing, even if the product later offers shortcuts.

## Useful Checks

- `command -v superplan` or equivalent command discovery for CLI availability
- `superplan doctor --json` when the CLI exists but readiness is unclear
- `~/.config/superplan/config.toml` for durable host defaults
- `<repo>/.superplan/config.toml` for repo-local initialization

## Keep Out Of `decisions.md`

- obvious "repo is initialized" notes
- obvious "setup exists" notes
- tiny readiness observations with no future value

## Good `decisions.md` Entries

- "Machine setup was missing, so Superplan workflow was deferred."
- "Repo init was missing, so structured workflow was deferred."
- "Brownfield repo lacked durable context; context bootstrap required before shaping."
