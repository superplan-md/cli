# Superplan CLI Context

## Project Overview
This project is a standalone CLI packaged for Superplan execution.
It provides repository initialization (via `superplan init`), machine/repo setup utilities (via `superplan setup`), environment validation (via `superplan doctor`), task parsing/truth-model generation (via `superplan parse`), and runtime-backed task inspection/execution state commands (via `superplan task`).

## Project Structure
- `src/cli/main.ts`: Main entry point for the CLI. Parses arguments, prints help when no command is provided, returns structured errors in JSON mode when `--json` is passed without a command, validates commands against the router, and then calls the router. The help output currently advertises `init`, `setup`, `doctor`, `parse`, and `task`.
- `src/cli/router.ts`: Exposes the CLI router object and maps supported commands (`init`, `setup`, `doctor`, `parse`, `task`) to handlers. Executes matched handlers and prints structured JSON responses.
- `src/cli/commands/init.ts`: Initializes the current repository for Superplan. Creates `.superplan/config.toml`, `.superplan/context/`, `.superplan/runtime/`, and `changes/`. On re-run, it prompts before reinitializing and returns a structured `{ ok: true, data: { root: ".superplan" } }` result on success.
- `src/cli/commands/setup.ts`: Implements scope-based setup for Superplan. Includes:
  - Interactive scope selection for `global`, `local`, `both`, or `skip`.
  - Idempotent global and local configuration/skills setup.
  - Interactive prompts using `@inquirer/prompts`.
  - Structured error and success return types.
  - Automatic detection of supported agent environments (`.claude`, `.gemini`, `.cursor`, `.vscode`, `.codex`) in the current working directory and the user home directory, depending on selected scope.
  - Installs skills to detected agents using symlinks (with a copy fallback).
- `src/cli/commands/doctor.ts`: Validates the current machine and repo environment. Checks for the global config file, verifies the global skills directory exists and contains at least one file, and ensures repo-local agent folders have `skills/superplan` installed when those agent directories are present.
- `src/cli/commands/parse.ts`: Parses either a single task markdown file or task markdown files discovered under `changes/` by default. Extracts `task_id` and `status` from frontmatter, reads the `Description` and `Acceptance Criteria` sections, converts markdown checklist items into structured acceptance-criteria objects, computes task progress fields, and returns parser diagnostics.
- `src/cli/commands/task.ts`: Reuses the parser to support `task show [task_id]` and `task start <task_id>`. `show` returns either one task or all parsed tasks, while `start` validates the task and persists execution state in `.superplan/runtime/tasks.json` without modifying markdown files.
- `skills/`: Local dummy skills source used by `setup` during development/testing. This directory is copied into the global Superplan skills directory during installation.
- `.superplan/config.toml`: Repo-local Superplan config created by `init` with `version = "0.1"`.
- `.superplan/runtime/tasks.json`: Runtime execution-state store for task commands. Created on demand and used to persist task start state.
- `package.json`: Configured with `"bin": { "superplan": "./dist/cli/main.js" }` for direct execution.
- `tsconfig.json`: Typings configuration.

## Command Guidelines
- **Output:** All commands must return a standard structured response instead of using direct `console.log` or `process.exit`.
  - Success format: `{ "ok": true, "data": { ... } }`
  - Failure format: `{ "ok": false, "error": { "code": "...", "message": "...", "retryable": boolean } }`
- **CLI Routing:** When no command is provided, the CLI prints help and exits cleanly. In `--json` mode with no command, it returns a structured `NO_COMMAND` error. Unknown commands return a structured `UNKNOWN_COMMAND` error.
- **Init Behavior:** `init` is repo-local and idempotent. It creates `.superplan/`, `.superplan/config.toml`, `.superplan/context/`, `.superplan/runtime/`, and `changes/`, and prompts before reinitializing an existing `.superplan/` directory.
- **Setup Source:** For development/testing, `setup` uses `path.join(process.cwd(), 'skills')` as the skills source. If that folder is missing, setup returns `SKILLS_SOURCE_MISSING`.
- **Setup Scope:** `setup` supports `global`, `local`, `both`, and `skip`. Global setup writes to `~/.config/superplan`, local setup writes to `.superplan/` and `changes/`, and agent integrations are installed from the corresponding scope’s skills directory.
- **Doctor Checks:** `doctor` always returns `{ ok: true, data: { valid, issues } }` and reports `CONFIG_MISSING`, `SKILLS_MISSING`, and `AGENT_SKILLS_MISSING` issues without throwing.
- **Parse Scope:** `parse` supports parsing one task markdown file, an entire change folder, or all discovered change tasks by default when no path is provided. It returns `{ ok: true, data: { tasks, diagnostics } }`. If the default `changes/` directory is missing, it returns `tasks: []` plus a `CHANGES_DIR_MISSING` diagnostic.
- **Parse Truth Model:** Each parsed task includes `task_id`, `status`, `description`, `acceptance_criteria`, `total_acceptance_criteria`, `completed_acceptance_criteria`, `progress_percent`, and `effective_status`. Diagnostics currently detect `TASK_ID_MISSING`, `DESCRIPTION_EMPTY`, and `ACCEPTANCE_CRITERIA_MISSING`.
- **Task Command Scope:** `task show [task_id]` reads from parsed tasks. `task start <task_id>` validates the task, refuses invalid tasks or completed tasks, and writes runtime status to `.superplan/runtime/tasks.json`.
- **Out of Scope:** Graph logic, dependency resolution, and markdown mutation for task execution are not implemented.
- **Location Constraints:** The setup should refer to variables dynamically using `os.homedir()` and `path.resolve` where appropriate.

*Continues to be updated based on new requirements.*
