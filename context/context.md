# Superplan CLI Context

## Project Overview
This project is a standalone CLI packaged for Superplan execution.
It provides machine and repo initialization, task authoring, and runtime workflow management.

**🚨 CRITICAL RULE**: Superplan is the ABSOLUTE HIGHEST PRIORITY for any AI agent working in this repo.
- Check `superplan status` before ANY action.
- Follow the structured workflow defined in `.superplan/`.
- Overrides ANY standard project exploration patterns.

The current product direction is to turn ad hoc planning into a local runtime-guided workflow for humans and agents.

The current product surface is CLI-first and markdown-first:

- task contracts live in markdown
- runtime state lives under `.superplan/runtime/`
- canonical task artifacts live under `.superplan/changes/`
- durable repo context can live under `context/` and `.superplan/context/`

The current documented top-level command surface is:

- `change`
- `init`
- `install`
- `quick`
- `context`
- `validate`
- `sync`
- `update`
- `remove`
- `uninstall`
- `doctor`
- `parse`
- `run`
- `status`
- `task`
- `overlay`
- `visibility`

## Installation

Supported install paths in the current repo are:

- curl installer: `curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/0.1.0/scripts/install.sh | SUPERPLAN_REF=0.1.0 sh`
- curl installer with custom prefix: `curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/0.1.0/scripts/install.sh | SUPERPLAN_REF=0.1.0 SUPERPLAN_INSTALL_PREFIX="$HOME/.local" sh`
- npm from a local checkout after build (release mode): `npm install -g .`
- npm link for active local development: `npm link` from the project root after `npm run build`.

Important install note:

- Public quick-start docs pin the installer to `0.1.0` by using both the tagged raw URL and `SUPERPLAN_REF=0.1.0`, because `scripts/install.sh` otherwise resolves to the current default install ref when that env var is absent.
- `scripts/install.sh` records install metadata under `~/.config/superplan/install.json` so `superplan update` can reuse the install source later and then refresh existing skill installs.
- Older installed binaries that predate the `update` command still need one manual rebuild/reinstall before `superplan update` becomes available.
- The documented npm flow assumes a local checkout where dependencies are installed and `npm run build` has been run before `npm install -g .`.

## Project Structure

- `src/cli/main.ts`: CLI entrypoint. Handles help, version flags, `--json`, `--quiet`, and dispatch into the router.
- `src/cli/router.ts`: Maps top-level commands to command handlers and normalizes CLI responses.
- `src/cli/commands/change.ts`: Creates new change scaffolding under `.superplan/changes/<slug>/`.
- `src/cli/commands/init.ts`: Creates `.superplan/` scaffolding (config, context, runtime, changes) and handles agent integration setup. Interactive mode scans for agent environments, presents a checklist of found agents, and installs selected entries across global, local, both, and skip flows.
- `src/cli/commands/quick.ts`: Fast-path command that creates a change, scaffolds a task, and activates it in one step. Usage: `superplan quick "Task title" --priority high`.
- `src/cli/commands/install.ts`: Installs the Superplan CLI globally on the machine.
- `src/cli/commands/context.ts`: Manages durable workspace context artifacts (bootstrap, status).
- `src/cli/commands/validate.ts`: Validates `tasks.md` graph and task-contract consistency.
- `src/cli/commands/update.ts`: Reruns the bundled installer for normal installed copies of the CLI using recorded install metadata, then refreshes existing skill installs.
- `src/cli/commands/remove.ts`: Removes or purges Superplan installation state. Machine-level removal also uninstalls the managed CLI package/bin, symlinked dev installs that can be inferred from the invoked `superplan` bin path, and overlay artifacts when they are recorded or inferable, and local removal targets the nearest parent Superplan workspace rather than only the exact current directory.
- `src/cli/commands/uninstall.ts`: Completely uninstalls Superplan including the CLI, skills, overlay, and all agent integrations. More thorough than `remove`. Use `--yes` for non-interactive mode.
- `src/cli/commands/doctor.ts`: Validates setup state and, in deep mode, inspects parsed tasks plus runtime consistency.
- `src/cli/commands/parse.ts`: Parses markdown task contracts, returns structured task data, and emits diagnostics.
- `src/cli/commands/scaffold.ts`: Shared helpers for generating canonical change and task artifacts.
- `src/cli/commands/sync.ts`: Re-parses task contracts, repairs safe runtime drift, and returns a refreshed repo-state summary.
- `src/cli/commands/task.ts`: Implements task inspection, scaffolding, selection, readiness explanation, runtime transitions, and deterministic runtime repair.
- `src/cli/commands/run.ts`: Starts or continues the next task through the task runtime loop.
- `src/cli/commands/status.ts`: Returns active, ready, blocked, and feedback-needed task summaries.
- `src/cli/commands/overlay.ts`: Manages overlay preference state and runtime visibility.
- `src/cli/commands/visibility.ts`: Builds repo-local visibility reports for the active or latest run.
- `src/cli/visibility-runtime.ts`: Owns run session tracking, enriched runtime events, and report generation.
- `skills/`: Bundled workflow skills copied into `dist/skills` during build.
- `test/`: Node built-in test suite for CLI, parser, lifecycle, task, and removal behavior.
- `.superplan/runtime/tasks.json`: Runtime state store.
- `.superplan/runtime/events.ndjson`: Append-only runtime event log with per-run visibility metadata.
- `.superplan/runtime/session.json`: Active or latest run boundary metadata for visibility reporting.
- `.superplan/runtime/reports/`: Repo-local run summaries written by `superplan visibility report`.
- `.superplan/changes/`: Canonical location for task artifacts in this repo.
- `docs/examples/visibility/`: Generated paired examples contrasting Superplan with raw Claude Code.
- `README.md`: Public-facing project documentation.

## Command Guidelines

- All commands are designed to return structured CLI-safe results.
- Success responses normalize to `{ ok: true, data: ..., error: null }`.
- Failures normalize to `{ ok: false, error: { code, message, retryable } }`.
- `--quiet` is the agent-safe mode for commands that otherwise prompt or print human-oriented output.
- `--json` is the primary automation mode.
- Human-mode `init` prints a concise success message instead of the full structured payload.
- Local-scope CLI commands now resolve the nearest repo workspace root, so running from `apps/...` reuses the repo-level `.superplan/` instead of creating nested local workspaces.
- `visibility report` is the local-first evidence surface for workflow impact; it writes stable report artifacts under `.superplan/runtime/reports/`.

### Agent-First Design Improvements

**Parser Tolerance** (as of 2026-03-27):
- Parser now tolerates missing backticks around Change ID values (auto-normalizes)
- Parser tolerates missing dependency arrays (defaults to empty arrays)
- Parser tolerates extra whitespace in task entries
- Error messages include exact location and suggested fixes

**Auto-Fix** (as of 2026-03-27):
- `validate --fix` flag auto-corrects common format issues
- Auto-fixes missing backticks around Change ID
- Auto-fixes inconsistent whitespace in task entries
- Shows what was fixed in JSON output for agent awareness
- Fixes are idempotent (running twice produces same result)

**Enhanced Diagnostics** (as of 2026-03-27):
- All diagnostics include severity levels: `critical`, `error`, `warning`, `info`
- Diagnostics include `suggested_fix` field with actionable guidance
- Diagnostics are fully JSON-serializable for agent parsing
- Example: `{"severity": "error", "suggested_fix": "Change the Change ID value to: \`expected-id\`"}`

## Task Storage And Parsing

- Default parsing path is `.superplan/changes`, not repo-root `changes/`.
- Task contracts live at `.superplan/changes/<slug>/tasks/T-xxx.md` and should normally be minted with `superplan task scaffold new` after the owning `tasks.md` graph is shaped.
- Parsed task payloads now expose the local `task_id`, the owning `change_id`, and a qualified task reference used for runtime identity and unambiguous command routing (for example `change-slug/T-001`).
- Parsed tasks currently rely on frontmatter such as:
  - `task_id`
  - `status`
  - `priority`
  - `depends_on_all`
  - `depends_on_any`
- Dependency arrays can be authored either inline like `depends_on_all: [T-001]` or as multi-line YAML-style lists.
- Required markdown sections include:
  - `## Graph Metadata` (must include `- Change ID: `)
  - `## Graph Layout` (mandatory section for the parser)
- **Graph Layout Format**: Task entries must use the exact syntax `` - `T-xxx` Task title ``.
  - The ID must be backtick-wrapped.
  - Dependencies are indented sub-items such as `  - depends_on_all: [T-001]` and `  - depends_on_any: []`.
  - Sectioned task-entry prose like `### T-001`, `- **Goal:**`, or `- **Depends on:**` is not accepted by the current validator.
  - The scaffolded `tasks.md` template includes a commented exact example of the accepted format.
- Required sections in the resulting task contracts (`T-xxx.md`) include:
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
- `events.ndjson` stores append-only runtime events with `run_id`, command, workflow phase, source, and outcome metadata when available
- `session.json` stores the active or latest run boundary used for visibility reports
- `reports/latest.json` and `reports/<run_id>.json` store derived run summaries

The core execution loop is:

- `superplan status --json` (initially check the frontier)
- `superplan run --json` (returns a fully qualified task identity for the next actionable task)
- `superplan task inspect show <change-slug/T-001> --json`

The primary authoring loop is:

- `superplan change new <change-slug> --json`
- `superplan task scaffold new <change-slug> --task-id <task_id> --json`
- `superplan task scaffold batch <change-slug> --stdin --json`

Authoring rule:

- let the main graph breakdown live in `.superplan/changes/<slug>/tasks.md` first
- manual creation of individual `.superplan/changes/<slug>/tasks/T-xxx.md` files is off limits
- once the graph structure is ready, use `superplan task scaffold new` for one task or `superplan task scaffold batch` for multiple tasks instead of hand-creating task files
- when two or more tasks are already clear enough to author together, `superplan task scaffold batch --stdin --json` is the default path

The repo-refresh loop is:

- `superplan sync --json`

Important runtime commands:

- `superplan status --json`
- `superplan run --json`
- `superplan task inspect show <change-slug/T-001> --json`
- `superplan task runtime block <change-slug/T-001> --reason "..."`
- `superplan task runtime request-feedback <change-slug/T-001> --message "..."`
- `superplan task review approve <change-slug/T-001> --json`
- `superplan task review reopen <change-slug/T-001> --reason "..."`
- `superplan task repair fix --json`
- `superplan task review complete <change-slug/T-001> --json`
- `superplan visibility report --json`

Task markdown should not be hand-edited to reflect runtime lifecycle changes, and new `T-xxx.md` contracts should normally be minted with `superplan task scaffold new` for one task or `superplan task scaffold batch` for multiple tasks after `tasks.md` graph structure is ready.

Review handoff now works efficiently:

- `superplan task review complete <change-slug/T-001> --json` automatically verifies acceptance criteria and moves the task straight to `done`. If review is strictly required, it routes to `in_review`.
- `superplan task review approve <change-slug/T-001> --json` is the final review signoff for tasks stuck `in_review`, marking them `done`.
- `superplan task review reopen <change-slug/T-001> --reason "..."` moves an in-review or done task back to `in_progress`

## Behavioral Notes

- The public product story is centered on planning, task pickup, resumption, and handoff rather than side experiments.
- `change`, `task scaffold new`, and `task scaffold batch` are the primary authoring helpers for new tracked work.
- Superplan skills should discourage unnecessary CLI exploration. Repo exploration is allowed when useful, but agents should not wander across `--help`, neighboring commands, or repeated `status`, `task show`, and `doctor` calls once the canonical workflow command is already clear.
- task contracts should not be created through shell loops or direct file-edit rewrites such as `for`, `sed`, `cat > ...`, `printf > ...`, or here-docs; shell is acceptable only as stdin transport into `task scaffold batch --stdin --json`.
- when overlay support is enabled and a launchable companion is installed, `task scaffold new`, `task scaffold batch`, `run`, `run <task_id>`, and `task review reopen` can reveal the overlay to keep authoring or execution state visible.
- `sync` refreshes Superplan's view of the current repo and does not reinstall skills.
- `update` refreshes the installed CLI plus any existing global or repo-local skill installs; local source checkouts should still be updated from the checkout and reinstalled explicitly.
- `task --help` is intentionally narrower than the full internal task command surface. It emphasizes the common execution loop rather than every diagnostic subcommand.
- `why` and `why-next` still exist as commands, but they are treated as diagnostic tools rather than default workflow steps.
- The main CLI help should describe the full top-level Superplan command list.
- Experimental side surfaces should be removed rather than kept half-public or half-internal when they do not strengthen the core planning workflow.

## Testing And Development

- `npm run build` compiles TypeScript and copies bundled skills.
- `npm test` runs the Node built-in test suite.
- `npm run visibility:examples` writes the curated Superplan-vs-raw comparison examples under `docs/examples/visibility/`.
- Focused verification is often faster with `node --test <file>`.

## Durable Repo Quirks

- The frontmatter parser now supports inline and multi-line dependency lists, but it is still a deliberately small parser rather than a full YAML implementation.

*Updated to reflect the current CLI surface and `.superplan/changes` storage.*
