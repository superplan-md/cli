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
  - Automatic detection of supported agent environments (`.claude`, `.gemini`, `.cursor`, `.codex`, `.opencode`) in the current working directory and the user home directory, depending on selected scope.
  - Installs Superplan into agent-specific target locations: peer skill directories for Claude/Cursor/Codex/OpenCode, and Gemini TOML command files.
- `src/cli/commands/doctor.ts`: Validates the current machine and repo environment. Checks for the global config file, verifies the global skills directory exists and contains at least one file, and ensures repo-local agent folders have the expected `superplan` skills install in the correct per-agent path.
- `src/cli/commands/parse.ts`: Parses either a single task markdown file or task markdown files discovered under `changes/` by default. Extracts `task_id`, `status`, `depends_on_all`, and `depends_on_any` from frontmatter, reads the `Description` and `Acceptance Criteria` sections, converts markdown checklist items into structured acceptance-criteria objects, computes task progress/readiness fields, and returns parser diagnostics.
- `src/cli/commands/task.ts`: Reuses the parser to support `task list`, `task show [task_id]`, `task start <task_id>`, and `task complete <task_id>`. Task commands merge runtime state from `.superplan/runtime/tasks.json` with parsed task data and enforce strict runtime-state transitions without modifying markdown files.
- `skills/`: Local Superplan skill payload used by `setup` during development/testing and native skill installation for Claude/Cursor/Codex/OpenCode.
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
- **Agent Paths:** Repo-scoped agent detection uses `.claude`, `.gemini`, `.cursor`, `.codex`, and `.opencode`. Global detection uses home-directory dotfolders for Claude/Gemini/Cursor/Codex and `~/.config/opencode` for OpenCode. Claude receives peer skill folders under `.claude/skills/`, Cursor under `.cursor/skills/`, Codex under `.codex/skills/`, OpenCode under `.opencode/skills/` or `~/.config/opencode/skills/`, and Gemini receives `commands/superplan.toml`.
- **Doctor Checks:** `doctor` always returns `{ ok: true, data: { valid, issues } }` and reports `CONFIG_MISSING`, `SKILLS_MISSING`, and `AGENT_SKILLS_MISSING` issues without throwing.
- **Parse Scope:** `parse` supports parsing one task markdown file, an entire change folder, or all discovered change tasks by default when no path is provided. It returns `{ ok: true, data: { tasks, diagnostics } }`. If the default `changes/` directory is missing, it returns `tasks: []` plus a `CHANGES_DIR_MISSING` diagnostic.
- **Parse Truth Model:** Each parsed task includes `task_id`, `status`, `depends_on_all`, `depends_on_any`, `description`, `acceptance_criteria`, `total_acceptance_criteria`, `completed_acceptance_criteria`, `progress_percent`, `effective_status`, `is_valid`, `is_ready`, and `issues`. Diagnostics currently detect `CHANGES_DIR_MISSING`, `TASK_ID_MISSING`, `INVALID_STATUS_VALUE`, `TASK_WITH_NO_DESCRIPTION`, `EMPTY_ACCEPTANCE_CRITERIA`, `DUPLICATE_TASK_ID`, and `TASK_READ_FAILED`.
- **Task Command Scope:** `task list` returns all tasks with runtime state merged in. `task show [task_id]` returns either all tasks or a single task with runtime state merged in. `task start <task_id>` validates the task, enforces that only one task may be `in_progress`, treats runtime `done` as terminal, and is idempotent when the same task is already active. `task complete <task_id>` requires runtime `in_progress` plus fully completed acceptance criteria before writing runtime status `done`.
- **Out of Scope:** Graph logic, dependency resolution, and markdown mutation for task execution are not implemented.
- **Location Constraints:** The setup should refer to variables dynamically using `os.homedir()` and `path.resolve` where appropriate.

*Continues to be updated based on new requirements.*
