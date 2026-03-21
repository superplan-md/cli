# Superplan CLI

Turn normal planning into an executable local workflow.

Superplan is a lightweight planning and execution CLI for repositories that want durable task contracts, agent-friendly JSON output, and a simple runtime loop without a heavyweight project system.

## Quick Start

### Install with curl

If you want a one-command installer, use:

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/cli/alpha.4/scripts/install.sh | SUPERPLAN_REF=alpha.4 sh
```

That pins both the fetched installer and the repo checkout to the `alpha.4` release tag.

The installer:

- clones the Superplan CLI repo
- installs dependencies when needed
- builds the CLI
- installs `superplan` globally with npm
- installs the packaged desktop overlay companion for the current macOS or Linux platform when a release artifact is available
- runs machine-level `superplan setup` automatically so bundled skills are ready immediately
- enables the desktop overlay by default on this machine unless `SUPERPLAN_ENABLE_OVERLAY=0` is set

Prerequisites:

- `node`
- `npm`
- `git`

You can also install to a custom npm prefix:

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/cli/alpha.4/scripts/install.sh | SUPERPLAN_REF=alpha.4 SUPERPLAN_INSTALL_PREFIX="$HOME/.local" sh
```

### Install with npm from a local checkout

If you prefer an npm-driven install from source, build the CLI and install it globally from the repo root:

```bash
git clone --branch alpha.4 --depth 1 https://github.com/superplan-md/cli.git
cd cli
npm install
npm run build
npm install -g .
```

Then verify the CLI is available:

```bash
superplan --version
```

When the overlay companion is installed and enabled, the first real execution transition in a repo automatically reveals it. In practice, `superplan run`, `superplan run <task_id>`, and `superplan task reopen` all surface the overlay when work becomes active. Explicit `superplan overlay ensure` / `hide` commands still exist for manual control and agent guidance.

To update a normal installed copy later:

```bash
superplan update
```

`superplan update` now does two things for normal installed copies:

- updates the installed CLI
- refreshes bundled Superplan skills for any existing global or repo-local setup it finds in the current environment

If `superplan update` returns `Unknown command: update`, the installed binary is older than the update feature. In that case, do a one-time manual refresh from a checkout:

```bash
npm run build
npm install -g .
```

After that bootstrap update, future CLI refreshes can use `superplan update`.

For local source installs, update from the checkout and reinstall explicitly.

If task files or runtime state were edited outside the normal CLI loop and you want Superplan to reconcile the repo without touching installed skills:

```bash
superplan sync --json
```

### Overlay Release Packaging

For release engineering, the packaged overlay artifacts consumed by the installer are produced with stable names:

```bash
npm run overlay:release
```

That command emits the current platform's installer-ready overlay artifact under:

```text
dist/release/overlay/
```

Current stable artifact names:

- macOS: `superplan-overlay-darwin-arm64.tar.gz` or `superplan-overlay-darwin-x64.tar.gz`
- Linux: `superplan-overlay-linux-x64.AppImage` or `superplan-overlay-linux-arm64.AppImage`

`scripts/install.sh` looks for those local packaged artifacts first for source-based installs, and otherwise downloads the matching release asset for the current platform from the configured release base URL.

### Run from source without a global install

#### 1. Install dependencies

```bash
npm install
```

#### 2. Build the CLI

```bash
npm run build
```

#### 3. Set up Superplan

Global setup:

```bash
node dist/cli/main.js setup
```

Interactive setup now scans for agent environments first, shows only the agents it actually found for that scope, includes a `Found:` hint plus a `Select all found AI agents` option when there are multiple detections, and runs immediately after those choices without an extra generic confirmation step.

Successful human-mode `setup` now ends with a short `Superplan setup completed successfully.` message instead of dumping the full structured result payload.

Local Superplan commands resolve to the nearest repo workspace root when run from subdirectories, so `setup`, `init`, and task/change commands reuse the repo-level `.superplan/` instead of creating nested ones under `apps/...`.

Quiet machine-level setup for automation:

```bash
node dist/cli/main.js setup --quiet --json
```

#### 4. Initialize a repo

```bash
node dist/cli/main.js init --quiet --json
```

That creates the repo-local Superplan scaffold:

```text
.superplan/
  changes/
  context/
  runtime/
  config.toml
```

#### 5. Create your first change and task

```bash
superplan change new improve-task-authoring --json
superplan task new improve-task-authoring --title "Add authoring scaffold" --json
```

If you already know several tasks for the same change, use one batch scaffold call instead of repeated single-task calls:

```bash
printf '%s' '[{"title":"Add authoring scaffold"},{"title":"Add help coverage"}]' | superplan task batch improve-task-authoring --stdin --json
```

## Why Superplan

Superplan keeps three layers separate:

- **Task contracts**: markdown files that describe scope, dependencies, and acceptance criteria
- **Runtime state**: active, blocked, feedback-needed, and completed state under `.superplan/runtime`
- **Durable context**: reusable repo truths under `.superplan/context`

That split makes it easier to reason about what work exists, what is happening now, and what future agents should know.

It is built for teams and coding agents that want planning to stay:

- local and inspectable
- resumable after interruptions
- shared between humans and agents
- structured enough to pick the right next task without a separate web app

## Normal Planning Vs Superplan

Normal planning in a repo usually means some mix of chat history, scratch notes, TODO comments, and memory. That works until work gets interrupted, handed off, or split across dependencies.

Superplan keeps the same markdown-friendly workflow, but adds runtime truth:

| Normal planning | Superplan planning |
| --- | --- |
| Notes and plans drift across chats and files | Task contracts live under `.superplan/changes/` |
| The next step is often guessed manually | `superplan run --json` picks or continues the next task |
| “Done” often means different things to different people | `complete`, `approve`, and `reopen` make review state explicit |
| Blocked work is easy to lose track of | Runtime state records `blocked`, `needs_feedback`, and `done` |
| Handoffs depend on chat context | JSON-first commands and durable context make work resumable |
| Planning structure is often handwritten | `superplan change new`, `superplan task new`, and `superplan task batch` scaffold the common path |

## Core Workflow

The intended runtime loop is:

```bash
superplan status --json
superplan run --json
```

Use the task returned by `superplan run --json` directly. Reach for `superplan task show <task_id> --json` only when one task needs deeper detail or readiness reasons. If you need to activate one known task directly, use `superplan run <task_id> --json`.

Canonical agent authoring rule:

- use `superplan change new <change-slug> --json` once per tracked change
- use `superplan task new <change-slug> --title "..." --json` only when exactly one task should be created now
- use `superplan task batch --stdin --json` when two or more tasks are ready to be created in one pass
- prefer commands that already return the needed task payload over extra follow-up calls
- use the returned payload from `task new` or `task batch` directly instead of immediately calling `task show`

When you are shaping new work instead of executing existing work, start with:

```bash
superplan change new <change-slug> --json
superplan task new <change-slug> --title "Describe the first task" --json
```

If you are creating more than one task at once, prefer:

```bash
printf '%s' '[{"title":"Describe the first task"},{"title":"Describe the second task"}]' | superplan task batch <change-slug> --stdin --json
```

Then continue with whichever runtime command matches the situation:

```bash
superplan task block <task_id> --reason "..."
superplan task request-feedback <task_id> --message "..."
superplan task fix --json
superplan task complete <task_id> --json
superplan task approve <task_id> --json
superplan task reopen <task_id> --reason "..."
```

Use `superplan sync --json` only when task files or runtime state changed outside the normal execution loop and you need Superplan to re-parse, repair safe drift, and refresh overlay/runtime state.

Review handoff works like this:

```bash
superplan task complete <task_id> --json   # implementation done, send to review
superplan task approve <task_id> --json    # final signoff, mark done
superplan task reopen <task_id> --reason "Changes requested"
```

> Do not hand-edit lifecycle state in markdown task files. Use runtime commands.

## Command Surface

Current top-level commands:

| Command | What it does |
| --- | --- |
| `change` | Create tracked work structure |
| `init` | Scaffold the repo-local Superplan workspace |
| `setup` | Install Superplan config, bundled skills, and the agent integrations you select |
| `sync` | Re-parse tasks and repair safe runtime drift after task-file or runtime edits |
| `update` | Update an installed Superplan CLI and refresh existing skills |
| `remove` | Remove a Superplan installation or state; use `--scope ... --yes --json` for agent-safe deletion |
| `doctor` | Validate setup, install, and overlay health |
| `parse` | Parse task contracts and return diagnostics |
| `run` | Start, resume, or continue task execution |
| `status` | Show active, ready, in-review, blocked, and feedback-needed tasks |
| `task` | Inspect and transition task runtime state, including review handoff |

Task-specific help is available via:

```bash
superplan task --help
superplan change --help
```

## Task Contracts

Superplan uses markdown task files stored under:

```text
.superplan/changes/<change-slug>/tasks/T-xxx.md
```

You can scaffold the common path instead of writing everything by hand:

```bash
superplan change new improve-task-authoring --json
superplan task new improve-task-authoring --title "Add change scaffolding" --json
```

For multi-task shaping, batch scaffolding is usually faster and produces fewer follow-up CLI calls:

```bash
printf '%s' '[{"title":"Add change scaffolding"},{"title":"Add help coverage"}]' | superplan task batch improve-task-authoring --stdin --json
```

Task IDs are allocated globally across `.superplan/changes/` so dependencies and runtime references stay unambiguous across changes.

Each task contract is expected to include:

- frontmatter with fields such as `task_id`, `status`, `priority`, `depends_on_all`, and `depends_on_any`
- a `## Description` section
- a `## Acceptance Criteria` section using markdown checkboxes

Example:

```md
---
task_id: T-001
status: pending
priority: high
depends_on_all: []
depends_on_any: []
---

## Description
Ship the parser diagnostics update.

## Acceptance Criteria
- [ ] Invalid status values return a stable diagnostic
- [ ] Duplicate task ids are surfaced clearly
```

## Repo Layout

```text
src/cli/
  main.ts
  router.ts
  commands/
skills/
test/
.superplan/
  changes/
  context/
  runtime/
```

Key areas:

- `src/cli/commands/`: command implementations
- `skills/`: bundled Superplan workflow skills
- `test/`: Node test suite
- `.superplan/changes/`: repo-local task artifacts
- `.superplan/context/`: durable workspace context
- `.superplan/runtime/`: task runtime state and events

## Development

Install, build, and test:

```bash
npm install
npm run build
npm test
```

Focused verification is often faster while iterating:

```bash
node --test test/cli.test.cjs
node --test test/task.test.cjs
node --test test/parse.test.cjs
```

## JSON-First Automation

Most commands support `--json`, which makes the CLI usable as a shared control plane for agents and scripts.

Examples:

```bash
superplan status --json
superplan run --json
superplan task show T-001 --json
superplan parse --json
```

## Notes

- The main CLI help shows the top-level Superplan commands.
- `superplan task --help` is intentionally narrower and emphasizes the core task loop.
- `superplan change new`, `superplan task new`, and `superplan task batch` create the canonical authoring structure under `.superplan/changes/`.
- For agent-first flows, the canonical multi-task authoring path is `superplan task batch --stdin --json`; `--file <path>` is only a fallback when a persisted batch spec is useful.
- `superplan sync` is a recovery command for task-file edits or runtime drift, not part of the normal `status -> run` loop.
- `superplan remove` should use `--scope <local|global|both> --yes --json` in agent flows so the destructive intent is explicit.
- `superplan update` is intended for normal installed copies of the CLI, not local source checkouts, and refreshes skills for existing setups after a successful update.
- The current system is CLI-first and markdown-first.

## Credits

Parts of Superplan were inspired by Superpowers and its approach to structured local workflow.

## License

No license file is currently present in this repository.
