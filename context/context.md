# Superplan CLI Context

## Project Overview

This repository contains the TypeScript implementation of the `superplan` CLI.

The current product direction is to turn ad hoc planning into a local runtime-guided workflow for humans and agents.

The current product surface is CLI-first and markdown-first:

- task contracts live in markdown
- runtime state lives under `.superplan/runtime/`
- canonical task artifacts live under `.superplan/changes/`
- durable repo context can live under `context/` and `.superplan/context/`

The current documented top-level command surface is:

- `change`
- `init`
- `setup`
- `sync`
- `update`
- `remove`
- `purge`
- `doctor`
- `parse`
- `run`
- `status`
- `task`

## Installation

Supported install paths in the current repo are:

- curl installer: `curl -fsSL https://raw.githubusercontent.com/superplan-md/cli/dev/scripts/install.sh | sh`
- curl installer with custom prefix: `curl -fsSL https://raw.githubusercontent.com/superplan-md/cli/dev/scripts/install.sh | SUPERPLAN_INSTALL_PREFIX="$HOME/.local" sh`
- npm from a local checkout after build: `npm install -g .`

Important install note:

- `scripts/install.sh` now defaults `SUPERPLAN_REF` to `dev`, which matches the current tracked branch for this repository.
- `scripts/install.sh` records install metadata under `~/.config/superplan/install.json` so `superplan update` can reuse the install source later and then refresh existing skill installs.
- Older installed binaries that predate the `update` command still need one manual rebuild/reinstall before `superplan update` becomes available.
- The documented npm flow assumes a local checkout where dependencies are installed and `npm run build` has been run before `npm install -g .`.

## Project Structure

- `src/cli/main.ts`: CLI entrypoint. Handles help, version flags, `--json`, `--quiet`, and dispatch into the router.
- `src/cli/router.ts`: Maps top-level commands to command handlers and normalizes CLI responses.
- `src/cli/commands/change.ts`: Creates new change scaffolding under `.superplan/changes/<slug>/`.
- `src/cli/commands/init.ts`: Creates repo-local `.superplan/` scaffolding, including `.superplan/config.toml`, `.superplan/context/`, `.superplan/runtime/`, and `.superplan/changes/`.
- `src/cli/commands/setup.ts`: Installs Superplan config and bundled skills for supported agent environments. Supports global, local, both, and skip flows.
- `src/cli/commands/update.ts`: Reruns the bundled installer for normal installed copies of the CLI using recorded install metadata, then refreshes existing skill installs.
- `src/cli/commands/remove.ts`: Removes or purges Superplan installation state. Local removal now treats `.superplan/changes/` as part of repo-local Superplan state.
- `src/cli/commands/doctor.ts`: Validates setup state and, in deep mode, inspects parsed tasks plus runtime consistency.
- `src/cli/commands/parse.ts`: Parses markdown task contracts, returns structured task data, and emits diagnostics.
- `src/cli/commands/scaffold.ts`: Shared helpers for generating canonical change and task artifacts.
- `src/cli/commands/sync.ts`: Re-parses task contracts, repairs safe runtime drift, and returns a refreshed repo-state summary.
- `src/cli/commands/task.ts`: Implements task inspection, scaffolding, selection, readiness explanation, runtime transitions, and deterministic runtime repair.
- `src/cli/commands/run.ts`: Starts or continues the next task through the task runtime loop.
- `src/cli/commands/status.ts`: Returns active, ready, blocked, and feedback-needed task summaries.
- `skills/`: Bundled workflow skills copied into `dist/skills` during build.
- `test/`: Node built-in test suite for CLI, parser, lifecycle, task, and removal behavior.
- `.superplan/runtime/tasks.json`: Runtime state store.
- `.superplan/runtime/events.ndjson`: Append-only task lifecycle event log.
- `.superplan/changes/`: Canonical location for task artifacts in this repo.
- `README.md`: Public-facing project documentation.

## Command Guidelines

- All commands are designed to return structured CLI-safe results.
- Success responses normalize to `{ ok: true, data: ..., error: null }`.
- Failures normalize to `{ ok: false, error: { code, message, retryable } }`.
- `--quiet` is the agent-safe mode for commands that otherwise prompt or print human-oriented output.
- `--json` is the primary automation mode.

## Task Storage And Parsing

- Default parsing path is `.superplan/changes`, not repo-root `changes/`.
- Task contracts live at `.superplan/changes/<slug>/tasks/T-xxx.md`.
- Task IDs are allocated globally across `.superplan/changes/`, not restarted per change.
- Parsed tasks currently rely on frontmatter such as:
  - `task_id`
  - `status`
  - `priority`
  - `depends_on_all`
  - `depends_on_any`
- Dependency arrays can be authored either inline like `depends_on_all: [T-001]` or as multi-line YAML-style lists.
- Required markdown sections include:
  - `## Description`
  - `## Acceptance Criteria`

Current parse diagnostics include:

- `CHANGES_DIR_MISSING`
- `TASK_ID_MISSING`
- `INVALID_STATUS_VALUE`
- `TASK_WITH_NO_DESCRIPTION`
- `EMPTY_ACCEPTANCE_CRITERIA`
- `DUPLICATE_TASK_ID`
- `TASK_READ_FAILED`

## Runtime Model

Runtime truth is stored under `.superplan/runtime/`.

- `tasks.json` stores merged execution state such as `in_progress`, `in_review`, `done`, `blocked`, and `needs_feedback`
- `events.ndjson` stores append-only lifecycle events

The core execution loop is:

- `superplan status --json`
- `superplan run --json`
- `superplan task show <task_id> --json`

The primary authoring loop is:

- `superplan change new <change-slug>`
- `superplan task new <change-slug> --title "..."`

The repo-refresh loop is:

- `superplan sync --json`

Important runtime commands:

- `superplan status --json`
- `superplan run --json`
- `superplan task show <task_id> --json`
- `superplan task block <task_id> --reason "..."`
- `superplan task request-feedback <task_id> --message "..."`
- `superplan task approve <task_id> --json`
- `superplan task reopen <task_id> --reason "..."`
- `superplan task fix --json`
- `superplan task complete <task_id> --json`

Task markdown should not be hand-edited to reflect runtime lifecycle changes.

Review handoff now works in two steps:

- `superplan task complete <task_id> --json` moves finished implementation into `in_review`
- `superplan task approve <task_id> --json` marks an in-review task as `done`
- `superplan task reopen <task_id> --reason "..."` moves an in-review or done task back to `in_progress`

## Behavioral Notes

- The public product story is centered on planning, task pickup, resumption, and handoff rather than side experiments.
- `change` and `task new` are the primary authoring helpers for new tracked work.
- `sync` refreshes Superplan's view of the current repo and does not reinstall skills.
- `update` refreshes the installed CLI plus any existing global or repo-local skill installs; local source checkouts should still be updated from the checkout and reinstalled explicitly.
- `task --help` is intentionally narrower than the full internal task command surface. It emphasizes the common execution loop rather than every diagnostic subcommand.
- `why` and `why-next` still exist as commands, but they are treated as diagnostic tools rather than default workflow steps.
- The main CLI help should describe the full top-level Superplan command list.
- Experimental side surfaces should be removed rather than kept half-public or half-internal when they do not strengthen the core planning workflow.

## Testing And Development

- `npm run build` compiles TypeScript and copies bundled skills.
- `npm test` runs the Node built-in test suite.
- Focused verification is often faster with `node --test <file>`.

## Durable Repo Quirks

- The frontmatter parser now supports inline and multi-line dependency lists, but it is still a deliberately small parser rather than a full YAML implementation.

*Updated to reflect the current CLI surface and `.superplan/changes` storage.*
