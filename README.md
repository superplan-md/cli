# Superplan CLI

Plan work in markdown. Run it with a runtime.

Superplan is a lightweight task execution CLI for repositories that want durable task contracts, agent-friendly JSON output, and a simple runtime loop without a heavyweight project system.

It is built for workflows where:

- tasks live in versioned markdown
- readiness is computed from task contracts plus runtime state
- humans and coding agents use the same command surface
- the repo stays inspectable without a database or web app

## Why Superplan

Superplan keeps three layers separate:

- **Task contracts**: markdown files that describe scope, dependencies, and acceptance criteria
- **Runtime state**: active, blocked, feedback-needed, and completed state under `.superplan/runtime`
- **Durable context**: reusable repo truths under `.superplan/context`

That split makes it easier to reason about what work exists, what is happening now, and what future agents should know.

## Quick Start

### Install with curl

If you want a one-command installer, use:

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/cli/main/scripts/install.sh | sh
```

The installer:

- clones the Superplan CLI repo
- installs dependencies when needed
- builds the CLI
- installs `superplan` globally with npm

Prerequisites:

- `node`
- `npm`
- `git`

You can also install to a custom npm prefix:

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/cli/main/scripts/install.sh | SUPERPLAN_INSTALL_PREFIX="$HOME/.local" sh
```

### Install from source

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

## Core Workflow

The intended execution loop is:

```bash
superplan status --json
superplan run --json
superplan task show <task_id> --json
```

Then continue with whichever runtime command matches the situation:

```bash
superplan task block <task_id> --reason "..."
superplan task request-feedback <task_id> --message "..."
superplan task fix --json
superplan task complete <task_id> --json
```

> Do not hand-edit lifecycle state in markdown task files. Use runtime commands.

## Command Surface

Current top-level commands:

| Command | What it does |
| --- | --- |
| `init` | Initialize Superplan in the current repo |
| `setup` | Install Superplan config and bundled skills |
| `remove` | Remove a Superplan installation |
| `purge` | Remove Superplan state more aggressively |
| `doctor` | Validate setup and installation health |
| `parse` | Parse task contracts and return diagnostics |
| `popup` | Open a persistent task popup on macOS |
| `run` | Start or continue the next task |
| `status` | Show active, ready, blocked, and feedback-needed tasks |
| `task` | Inspect and transition task runtime state |

Task-specific help is available via:

```bash
superplan task --help
```

## Task Contracts

Superplan currently uses markdown task files stored under:

```text
.superplan/changes/<change-slug>/tasks/T-xxx.md
```

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
- `superplan popup` is currently a macOS-only MVP.
- The current system is CLI-first and markdown-first; there is no active server surface right now.

## License

No license file is currently present in this repository.
