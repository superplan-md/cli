# Superplan CLI Context

## Project Overview
This project is a standalone CLI packaged for Superplan execution.
It provides repository initialization (via `superplan init`), machine/repo setup utilities (via `superplan setup`), environment validation (via `superplan doctor`), repository cleanup (`superplan remove` and `superplan purge`), task parsing/truth-model generation (via `superplan parse`), and runtime-backed task inspection/execution state commands (via `superplan task`).

## Project Structure
- `src/cli/main.ts`: Main entry point for the CLI. Parses arguments, prints help when no command is provided, returns structured errors in JSON mode when `--json` is passed without a command, supports `-v` / `--version`, validates commands against the router, and then calls the router. The help output currently advertises `init`, `setup`, `remove`, `purge`, `doctor`, `parse`, and `task`.
- `src/cli/router.ts`: Exposes the CLI router object and maps supported commands (`init`, `setup`, `remove`, `purge`, `doctor`, `parse`, `task`) to handlers. Executes matched handlers and prints structured JSON responses.
- `src/cli/commands/init.ts`: Initializes the current repository for Superplan. Creates `.superplan/config.toml`, `.superplan/context/`, `.superplan/runtime/`, and `changes/`. On re-run, it prompts before reinitializing and returns a structured `{ ok: true, data: { root: ".superplan" } }` result on success.
- `src/cli/commands/setup.ts`: Implements scope-based setup for Superplan. Includes:
  - Interactive scope selection for `global`, `local`, `both`, or `skip`.
  - Idempotent global and local configuration/skills setup.
  - Interactive prompts using `@inquirer/prompts`.
  - Structured error and success return types.
  - Automatic detection of supported agent environments (`.claude`, `.gemini`, `.cursor`, `.codex`, `.opencode`) in the current working directory and the user home directory, depending on selected scope.
  - Uses bundled CLI skills from `path.resolve(__dirname, '../../skills')`, which are copied into `dist/skills` at build time.
  - Installs Superplan into agent-specific target locations: Claude/Cursor/OpenCode markdown command files, Gemini TOML command files, and Codex skill directories.
- `src/cli/commands/remove.ts`: Removes or purges Superplan state. Supports interactive scope selection for `global`, `local`, `both`, or `skip`, removes agent installs for the selected scope, and optionally removes local `changes/` during `purge`.
- `src/cli/commands/doctor.ts`: Validates the current machine and repo environment. Checks for the global config file, verifies the global skills directory exists and contains at least one file, and ensures repo-local agent folders have the expected `superplan` skills install in the correct per-agent path.
- `src/cli/commands/parse.ts`: Parses either a single task markdown file or task markdown files discovered under `changes/` by default. Extracts `task_id`, `status`, `depends_on_all`, and `depends_on_any` from frontmatter, reads the `Description` and `Acceptance Criteria` sections, converts markdown checklist items into structured acceptance-criteria objects, computes task progress fields, computes task readiness, and returns parser diagnostics.
- `src/cli/commands/task.ts`: Reuses the parser to support `task list`, `task current`, `task next`, `task show [task_id]`, `task why <task_id>`, `task events [task_id]`, `task start <task_id>`, `task resume <task_id>`, `task complete <task_id>`, `task reset <task_id>`, `task block <task_id> --reason <reason>`, and `task request-feedback <task_id> --message <message>`. Task commands merge runtime state from `.superplan/runtime/tasks.json` with parsed task data, append runtime events to `.superplan/runtime/events.ndjson`, and enforce strict runtime-state transitions without modifying markdown files.
- `skills/`: Bundled Superplan skill payload copied into `dist/skills` for setup/install flows. Includes the Codex `SKILL.md` and additional local skill assets.
- `.superplan/config.toml`: Repo-local Superplan config created by `init` with `version = "0.1"`.
- `.superplan/runtime/tasks.json`: Runtime execution-state store for task commands. Created on demand and used to persist `in_progress`, `done`, `blocked`, and `needs_feedback` state.
- `.superplan/runtime/events.ndjson`: Append-only runtime event log for task lifecycle events such as `task.started`, `task.completed`, `task.complete_failed`, `task.blocked`, `task.feedback_requested`, `task.resumed`, and `task.reset`.
- `package.json`: Configured with `"bin": { "superplan": "./dist/cli/main.js" }` for direct execution.
- `tsconfig.json`: Typings configuration.

## Command Guidelines
- **Output:** All commands must return a standard structured response instead of using direct `console.log` or `process.exit`.
  - Success format: `{ "ok": true, "data": { ... } }`
  - Failure format: `{ "ok": false, "error": { "code": "...", "message": "...", "retryable": boolean } }`
- **CLI Routing:** When no command is provided, the CLI prints help and exits cleanly. In `--json` mode with no command, it returns a structured `NO_COMMAND` error. Unknown commands return a structured `UNKNOWN_COMMAND` error. The CLI also supports `-v` and `--version`.
- **Init Behavior:** `init` is repo-local and idempotent. It creates `.superplan/`, `.superplan/config.toml`, `.superplan/context/`, `.superplan/runtime/`, and `changes/`, and prompts before reinitializing an existing `.superplan/` directory.
- **Setup Source:** `setup` loads bundled skills from the installed CLI package via `path.resolve(__dirname, '../../skills')`, so setup works from arbitrary repositories after build/install instead of depending on the user repo containing a `skills/` folder.
- **Setup Scope:** `setup` supports `global`, `local`, `both`, and `skip`. Global setup writes to `~/.config/superplan`, local setup writes to `.superplan/` and `changes/`, and agent integrations are installed from the corresponding scope’s skills directory.
- **Agent Paths:** Repo-scoped agent detection uses `.claude`, `.gemini`, `.cursor`, `.codex`, and `.opencode`. Global detection uses home-directory dotfolders for Claude/Gemini/Cursor/Codex and `~/.config/opencode` for OpenCode. Claude/Cursor/OpenCode receive `commands/superplan.md`, Gemini receives `commands/superplan.toml`, and Codex receives `skills/superplan/`.
- **Removal Scope:** `remove` and `purge` support `global`, `local`, `both`, and `skip`. They remove the selected Superplan config/agent installs, and `purge` additionally removes local `changes/`.
- **Doctor Checks:** `doctor` always returns `{ ok: true, data: { valid, issues } }` and reports `CONFIG_MISSING`, `SKILLS_MISSING`, and `AGENT_SKILLS_MISSING` issues without throwing.
- **Parse Scope:** `parse` supports parsing one task markdown file, an entire change folder, or all discovered change tasks by default when no path is provided. It returns `{ ok: true, data: { tasks, diagnostics } }`. If the default `changes/` directory is missing, it returns `tasks: []` plus a `CHANGES_DIR_MISSING` diagnostic.
- **Parse Truth Model:** Each parsed task includes `task_id`, `status`, `depends_on_all`, `depends_on_any`, `description`, `acceptance_criteria`, `total_acceptance_criteria`, `completed_acceptance_criteria`, `progress_percent`, `effective_status`, `is_valid`, `is_ready`, and `issues`. Diagnostics include `TASK_ID_MISSING`, `DUPLICATE_TASK_ID`, `INVALID_STATUS_VALUE`, `TASK_WITH_NO_DESCRIPTION`, `EMPTY_ACCEPTANCE_CRITERIA`, `TASK_READ_FAILED`, and `CHANGES_DIR_MISSING`. Allowed frontmatter statuses are `pending`, `in_progress`, and `done`.
- **Task Readiness:** Readiness is computed from parser validity, runtime-merged status, and dependency satisfaction. Missing dependency tasks are treated as not done. Runtime `done`, `in_progress`, `blocked`, and `needs_feedback` override markdown execution state.
- **Task Command Scope:** `task list` returns all tasks with runtime state merged in. `task current` returns the single active task or `null`. `task next` returns the current `in_progress` task or the first ready task sorted by `task_id`. `task show [task_id]` returns either all tasks or a single task with runtime state merged in. `task why <task_id>` returns the reasons a task is or is not ready. `task events [task_id]` returns runtime event history. `task start <task_id>` validates the task, enforces that only one task may be `in_progress`, treats runtime `done` as terminal, and is idempotent when the same task is already active. `task resume <task_id>` restores a `blocked` or `needs_feedback` task to `in_progress`. `task complete <task_id>` requires runtime `in_progress` plus fully completed acceptance criteria before writing runtime status `done`. `task reset <task_id>` removes a task's runtime entry as an explicit recovery action. `task block <task_id>` and `task request-feedback <task_id>` transition the active task into paused runtime states.
- **Runtime Invariants:** Before task execution commands, runtime state enforces that at most one task may be `in_progress`. Invalid runtime states return `INVALID_STATE_MULTIPLE_IN_PROGRESS`.
- **Out of Scope:** Advanced graph scheduling beyond readiness checks, automated markdown mutation for execution state, and external task execution are not implemented.
- **Location Constraints:** The setup should refer to variables dynamically using `os.homedir()` and `path.resolve` where appropriate.

*Continues to be updated based on new requirements.*
