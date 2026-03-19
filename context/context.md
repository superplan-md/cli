# Superplan CLI Context

## Project Overview

This repository contains the TypeScript implementation of the `superplan` CLI.

The current product surface is CLI-first and markdown-first:

- task contracts live in markdown
- runtime state lives under `.superplan/runtime/`
- canonical task artifacts live under `.superplan/changes/`
- durable repo context can live under `context/` and `.superplan/context/`

The current top-level command surface is:

- `init`
- `setup`
- `remove`
- `purge`
- `doctor`
- `parse`
- `popup`
- `run`
- `status`
- `task`

The `server` surface has been intentionally removed for now.

## Project Structure

- `src/cli/main.ts`: CLI entrypoint. Handles help, version flags, `--json`, `--quiet`, and dispatch into the router.
- `src/cli/router.ts`: Maps top-level commands to command handlers and normalizes CLI responses.
- `src/cli/commands/init.ts`: Creates repo-local `.superplan/` scaffolding, including `.superplan/config.toml`, `.superplan/context/`, `.superplan/runtime/`, and `.superplan/changes/`.
- `src/cli/commands/setup.ts`: Installs Superplan config and bundled skills for supported agent environments. Supports global, local, both, and skip flows.
- `src/cli/commands/remove.ts`: Removes or purges Superplan installation state. Local removal now treats `.superplan/changes/` as part of repo-local Superplan state.
- `src/cli/commands/doctor.ts`: Validates setup state and, in deep mode, inspects parsed tasks plus runtime consistency.
- `src/cli/commands/parse.ts`: Parses markdown task contracts, returns structured task data, and emits diagnostics.
- `src/cli/commands/popup.ts`: Launches the macOS-only persistent task popup MVP, keeps a single popup process alive, and derives its display state from Superplan runtime truth.
- `src/cli/commands/task.ts`: Implements task inspection, selection, readiness explanation, runtime transitions, and deterministic runtime repair.
- `src/cli/commands/run.ts`: Starts or continues the next task through the task runtime loop and relies on the task pickup hook for popup launch behavior.
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
- Parsed tasks currently rely on frontmatter such as:
  - `task_id`
  - `status`
  - `priority`
  - `depends_on_all`
  - `depends_on_any`
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

- `tasks.json` stores merged execution state such as `in_progress`, `done`, `blocked`, and `needs_feedback`
- `events.ndjson` stores append-only lifecycle events

Important runtime commands:

- `superplan status --json`
- `superplan run --json`
- `superplan popup --json`
- `superplan task show <task_id> --json`
- `superplan task block <task_id> --reason "..."`
- `superplan task request-feedback <task_id> --message "..."`
- `superplan task fix --json`
- `superplan task complete <task_id> --json`

Task markdown should not be hand-edited to reflect runtime lifecycle changes.

## Behavioral Notes

- `task --help` is intentionally narrower than the full internal task command surface. It emphasizes the common execution loop rather than every diagnostic subcommand.
- `why` and `why-next` still exist as commands, but they are treated as diagnostic tools rather than default workflow steps.
- The main CLI help should describe the full top-level Superplan command list.
- `popup` is currently macOS-only and is implemented as a CLI-launched helper window rather than a full desktop app shell.
- Superplan now auto-opens the popup on macOS when a task is actually picked up through `run`, `task start`, or `task resume`.
- The popup command deduplicates itself so repeated `run` calls reuse the existing popup window instead of stacking duplicates.

## Testing And Development

- `npm run build` compiles TypeScript and copies bundled skills.
- `npm test` runs the Node built-in test suite.
- Focused verification is often faster with `node --test <file>`.

## Durable Repo Quirks

- The runtime/task display path still has a mismatch where `superplan task complete <task_id> --json` can succeed while `superplan task show <task_id> --json` may still display `in_progress`.
- The setup banner test in `test/lifecycle.test.cjs` has been a recurring unrelated failure point when running the full suite.
- If server functionality is revisited later, it should be reintroduced intentionally through the router, help text, and dedicated tests.

*Updated to reflect the current CLI surface, `.superplan/changes` storage, and the removal of the server command.*
