# Superplan CLI

Superplan is a CLI that turns planning into execution.

It gives your repo a structured runtime for work.
Tasks are explicit. State is tracked. Progress is real.

No drift. No guesswork. No lost context.

Runs locally. Open source. Plug and play.

Your agent doesn’t decide what to do next.
Superplan does.

<br/>

![Visual Selection](src/assets/visual_selection.png)

> Planning tells you what to do.
> Superplan makes sure it actually gets done.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.sh | sh
```

That uses a stable installer URL and resolves the latest published GitHub release tag automatically before installing the CLI and matching overlay artifact.
After install, Superplan asks whether you want to run `superplan init` immediately in the directory you launched from.

Windows PowerShell:

```powershell
curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd; if ($LASTEXITCODE -eq 0) { .\install-superplan.cmd }
```

Windows Command Prompt:

```bat
curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd && install-superplan.cmd
```

The Windows installer now installs the CLI and the packaged overlay companion when a matching Windows release artifact has been published to the repo's GitHub release.

## How it works

Superplan sits inside your repo and takes control of execution.

You define a change.
Superplan turns it into a graph of tasks.
The agent executes one task at a time through a runtime loop.

State is tracked. Progress is explicit. Nothing is lost.

Another agent can resume at any point without guessing.

This isn’t planning.
It’s controlled execution.

## Why Superplan?

Normal planning drifts. Superplan adds runtime truth.

| Normal planning                    | Superplan planning                              |
| ---------------------------------- | ----------------------------------------------- |
| Notes and plans drift across chats | Task contracts live under `.superplan/changes/` |
| The next step is often guessed     | `superplan run --json` continues the next task  |
| “Done” is often ambiguous          | `complete` and `approve` make review explicit   |
| Handoffs depend on chat memory     | Durable context makes work resumable            |

## What's Inside: The Skills Library

Superplan is powered by a set of composable skills that guide the full lifecycle:

* shaping work into task graphs
* executing tasks through a runtime loop
* validating against acceptance criteria
* handling failures, handoffs, and documentation

Each skill enforces structure so the agent doesn’t drift.

### 🛡️ Entry & Routing

* **superplan-entry**: The mandatory gatekeeper. Decides if Superplan should engage.
* **superplan-route**: Decides the structure depth (direct, task, slice, or program).
* **superplan-context**: Bootstrap and sync durable workspace context.

### 🎨 Shaping & Planning

* **superplan-brainstorm**: Use for design clarification when expectations are ambiguous.
* **superplan-shape**: Turns rough ideas into a validated graph and task contracts.
* **superplan-plan**: Produces implementation plans or execution sequences.
* **superplan-tdd**: Defines a task contract via tests before broad code changes.

### 🏗️ Execution & Handoff

* **superplan-execute**: The main runtime loop. Manages task pickup and resumption.
* **superplan-debug**: Systematic troubleshooting for stalled or failing work.
* **superplan-handoff**: Creates high-signal checkpoints for context loss or transfer.
* **superplan-postmortem**: Captures actionable learning after completion or failure.

### 🧪 Quality & Verification

* **superplan-review**: Validates implementation against specific acceptance criteria.
* **superplan-verify**: Gathers real evidence from the workspace before claiming success.
* **superplan-guard**: Adds the smallest durable guard to prevent silent regressions.
* **superplan-release**: Final discipline check before shipping or recommending as ready.
* **superplan-docs**: Syncs READMEs, help, and context with code and behavior changes.

## Get Started

### 1. Install Latest version

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.sh | sh
```

That uses a stable installer URL and resolves the latest published GitHub release tag automatically before installing the CLI and matching overlay artifact.

For Windows PowerShell:

```powershell
curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd; if ($LASTEXITCODE -eq 0) { .\install-superplan.cmd }
```

For Windows Command Prompt:

```bat
curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd && install-superplan.cmd
```

The Windows installer resolves the latest published GitHub release tag for the CLI source when `SUPERPLAN_REF` is not pinned, and it installs the Windows overlay companion when the matching release artifact has been published for that release tag.
After install, Superplan asks whether you want to run `superplan init` immediately in the directory you launched from.

If you want the direct PowerShell installer instead, this still works:

```powershell
irm https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.ps1 | iex
```

**Note on Overlay:** The Superplan desktop companion is optional. The installer can enable or disable it as your machine default, and you can always change that later with `superplan overlay enable --global` or `superplan overlay disable --global`.

If you want to pin a specific release instead, keep the same installer URL and set `SUPERPLAN_REF` explicitly:

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.sh | SUPERPLAN_REF=<version-tag> sh
```

```powershell
$env:SUPERPLAN_REF='<version-tag>'; curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd; if ($LASTEXITCODE -eq 0) { .\install-superplan.cmd }
```

```bat
set SUPERPLAN_REF=<version-tag> && curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd && install-superplan.cmd
```

### 2. Initialize

```bash
superplan init
```

### 3. Track a Change

```bash
superplan change new my-feature --json
# author .superplan/changes/my-feature/tasks.md using the exact graph syntax:
# - `T-001` First task title
#   - depends_on_all: []
#   - depends_on_any: []
# - `T-002` Follow-up task title
#   - depends_on_all: [T-001]
#   - depends_on_any: []
superplan validate my-feature --json
superplan task scaffold batch my-feature --stdin --json
```

## The Workflow Loop

Stay in the flow with narrow, JSON-first commands:

```bash
superplan status --json  # See what's next
superplan run --json     # Start/continue the next task
```

| Lifecycle   | Command                                    |
| ----------- | ------------------------------------------ |
| **Review**  | `superplan task complete <id>`             |
| **Signoff** | `superplan task approve <id>`              |
| **Blocker** | `superplan task block <id> --reason "..."` |
| **Fix**     | `superplan task fix --json`                |

---

## Core Philosophy

1. **Mandatory First Contact**: Every repo-work request must pass through `superplan-entry`.
2. **CLI as Control Plane**: Once engaged, the CLI is the absolute source of truth for runtime state. Never edit lifecycle metadata in task files by hand.
3. **Durable over Ephemeral**: Plans belong in the repo, not in chat memory.
4. **Fastest Path to Init**: If a repo needs Superplan, `init` should be automatic and invisible whenever possible.

For advanced setup, internal specs, and development details, see [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).

## Overlay Releases

Use the local packaging command when you only need the current machine's overlay artifact:

```bash
npm run overlay:release
```

Use the GitHub-backed release path when you need published native artifacts for macOS, Linux, and Windows from one command:

```bash
npm run overlay:release:github -- --tag <release-tag>
```

That dispatches a GitHub Actions matrix build and uploads the packaged overlay artifacts to the requested GitHub release tag.

## Credits

Inspired by **Superpowers** and its approach to structured agentic workflows.

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
