# Setup And Config

Use this reference when entry routing needs to explain where setup state, init state, or durable defaults belong.

## Setup Layers

- CLI install: `superplan` must exist as a machine-level command before normal workflow use
- host setup: `superplan init` makes Superplan available to the current agent environment
- workspace init: `superplan init --yes --json` is the fast agent path that makes the current repo participate in Superplan

Keep these layers distinct in user guidance.

## Stable Config Surfaces

- global config: `~/.config/superplan/config.toml`
- workspace integration markers: repo-managed instruction files such as `AGENTS.md`, `CLAUDE.md`, or agent skill folders

Workspace integration markers complement global config and let the current repo participate in Superplan.

## Default Setup Bias

- prefer global host integration by default when it actually matters for the current work
- treat local-only integration as an advanced path unless the user asks for it
- keep tracked Superplan state in `~/.config/superplan/` and repo-local agent instructions in the workspace

## What Belongs In Config

- saved user preferences
- host-specific defaults
- workspace workflow defaults
- future interruption or review preferences

Do not store these as ad hoc notes in `decisions.md`.

## Entry-Layer Guidance

- inspect config before asking repeated first-run questions
- do not treat missing workspace config as proof that the CLI is missing
- do not treat existing workspace config as proof that host setup is complete
- `init` handles both global host setup and repo-local initialization; do not reference a separate `setup` command
- when the CLI already exists and Superplan should engage, prefer running repo-local init instead of turning init into a user-owned prerequisite
