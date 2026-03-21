# Superplan CLI

Superplan is a local, agent-first planning and execution CLI for repositories.

It turns rough planning into repo-native task contracts, explicit runtime state, and durable context under `.superplan/` so work stays structured, inspectable, and resumable.

Use Superplan when you want:

- a simple plug-and-play install for local agent workflows
- a narrow JSON-first command loop instead of chat-memory task tracking
- explicit task, review, and blocker state that another agent can resume later
- local workflow structure without adopting a heavyweight project system

## Why Use Superplan

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

Superplan keeps three layers separate:

- **Task contracts**: markdown files that describe scope, dependencies, and acceptance criteria
- **Runtime state**: active, blocked, feedback-needed, and completed state under `.superplan/runtime`
- **Durable context**: reusable repo truths under `.superplan/context`

That split makes it easier to reason about what work exists, what is happening now, and what future agents should know.

## Installation

The fastest path is the one-command installer below. For most users, Superplan should feel plug-and-play: install it, let it set up the bundled skills, and start using it in a repo right away.

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

### First commands after install

Once `superplan` is available, go to the repo you want to use and run:

```bash
cd /path/to/your/repo
superplan setup
superplan init --json
```

That gives you the usual first-run path:

- `superplan setup` installs or refreshes the machine and agent integrations
- `superplan init --json` creates the repo-local `.superplan/` workspace

If you used the one-command curl installer, machine-level `setup` is already run automatically, but this is still the right first-use sequence to remember and safe to rerun when needed.

When the overlay companion is installed and enabled, the first real authoring or execution transition in a repo can reveal it. In practice, `superplan task new`, `superplan task batch`, `superplan run`, `superplan run <task_id>`, and `superplan task reopen` can surface the overlay. Explicit `superplan overlay ensure` / `hide` commands still exist for manual control and agent guidance.

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

## How It Works

Superplan starts from the moment an agent needs durable structure in a repo. Instead of relying on chat memory, scratch notes, or ad hoc TODOs, it gives the work a local home under `.superplan/`.

First, it shapes the work into tracked changes and task contracts. `superplan change new` creates the change root, `superplan task new` creates one task, and `superplan task batch` creates multiple tasks when the graph is already clear.

Once the work is shaped, the execution loop stays narrow on purpose. `superplan status --json` shows the frontier, `superplan run --json` claims or continues work, and `superplan task show <task_id> --json` is there only when one task needs deeper inspection.

As work moves forward, runtime state stays explicit instead of being implied by chat. Tasks can be blocked, handed back for feedback, completed for review, approved, or reopened with dedicated commands.

Because task contracts, runtime state, and durable context all live locally in the repo, another agent can resume later without guessing what was intended or what happened last.

## The Basic Workflow

1. Install Superplan and verify `superplan --version`.
2. Initialize the repo with `superplan init --json`.
3. Create a tracked change with `superplan change new <change-slug> --json`.
4. Create one task with `superplan task new ... --json`, or multiple tasks with `superplan task batch --stdin --json`.
5. Use `superplan status --json` and `superplan run --json` as the default execution loop.
6. Move work through `block`, `request-feedback`, `complete`, `approve`, and `reopen` instead of editing lifecycle state by hand.
7. Resume later from the same local task contracts, runtime state, and context instead of rebuilding state from chat history.

## Canonical Runtime Loop

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
# shape .superplan/changes/<change-slug>/tasks.md
superplan task new <change-slug> --title "Describe the first task" --json
```

If you are creating more than one task at once after the graph is ready, prefer:

```bash
printf '%s' '[{"title":"Describe the first task"},{"title":"Describe the second task"}]' | superplan task batch <change-slug> --stdin --json
```

Let the main graph breakdown live in `.superplan/changes/<change-slug>/tasks.md` first. Once that structure is ready, use `superplan task new` for one task or `superplan task batch` for multiple tasks instead of hand-creating `tasks/T-xxx.md`.

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
| `overlay` | Inspect or control the desktop overlay companion |
| `visibility` | Inspect run visibility and health evidence |

Task-specific help is available via:

```bash
superplan task --help
superplan change --help
superplan visibility --help
```

## Visibility Reports

The visibility program keeps workflow evidence local to the repo.

Core command:

```bash
superplan visibility report --json
```

That command:

- groups enriched runtime events into the current or latest run
- writes repo-local reports under `.superplan/runtime/reports/`
- includes doctor/runtime health and overlay visibility signals
- keeps older minimal event logs readable through a `legacy-history` fallback

Current report inputs and artifacts:

- `.superplan/runtime/events.ndjson`
- `.superplan/runtime/session.json`
- `.superplan/runtime/reports/latest.json`
- `.superplan/runtime/reports/<run_id>.json`

For internal paired examples that contrast Superplan with raw Claude Code:

```bash
npm run visibility:examples
```

That script writes curated markdown and JSON examples under `docs/examples/visibility/`.

## Task Contracts

Superplan uses markdown task files stored under:

```text
.superplan/changes/<change-slug>/tasks/T-xxx.md
```

Do not hand-create `tasks/T-xxx.md` just to allocate an ID. Shape the graph in `tasks.md` first, then use `superplan task new` for one task or `superplan task batch` for multiple tasks to mint canonical task contract shells.

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
- `docs/examples/visibility/`: generated Superplan-vs-raw comparison examples

## Development

Install, build, and test:

```bash
npm install
npm run build
npm test
npm run visibility:examples
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
