# Superplan CLI

Superplan is a CLI that turns planning into actual execution inside your repository.

Instead of vague plans, chat history, or TODO lists, Superplan forces work into clear, step-by-step tasks that can be executed, tracked, and resumed at any time.

---

## Why use Superplan?

Most work fails because:

* plans drift across chats and notes
* steps get skipped
* progress is unclear
* AI agents lose direction

Superplan fixes this by making work **explicit and structured**.

---

## Installation

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.sh | sh
```

### Windows (PowerShell)

```powershell
curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd; if ($LASTEXITCODE -eq 0) { .\install-superplan.cmd }
```

### Windows (Command Prompt)

```cmd
curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd && install-superplan.cmd
```

After install, Superplan will ask if you want to run `superplan init`.

---

## Quick Start

```bash
superplan init
superplan change new my-feature --json
superplan run --json
```

---

## How it works

Superplan lives inside your repo and controls execution.

1. You define a change
2. Superplan converts it into tasks
3. Tasks are executed one by one
4. Progress is saved and tracked

Everything is stored in:

```
.superplan/changes/
```

This means:

* no lost context
* no guessing what's next
* work can be resumed anytime

---

## Example Workflow

Create a change:

```bash
superplan change new my-feature --json
```

Define tasks inside:

```
.superplan/changes/my-feature/tasks.md
```

Run execution:

```bash
superplan run --json
```

Track progress:

```bash
superplan status --json
```

Complete tasks:

```bash
superplan task complete <id>
superplan task approve <id>
```

---

## What makes it different?

| Normal planning            | Superplan                 |
| -------------------------- | ------------------------- |
| Notes scattered everywhere | Tasks stored in repo      |
| Next step is guessed       | CLI tells you what's next |
| Progress unclear           | State is tracked          |
| Hard to resume             | Fully resumable           |

---

## Core idea

Superplan is not a planning tool.

It is an execution system.

It ensures:

* every step is defined
* every task is tracked
* nothing is skipped

---

## Who is this for?

* Developers who want structured execution
* Teams working on complex features
* Anyone using AI agents and tired of drift

---

## Skills System (Advanced)

Superplan uses internal "skills" to manage execution:

* planning and task creation
* execution loop
* debugging and recovery
* validation and review

You don't need to learn these to get started, but they enforce structure behind the scenes.

---

## Summary

Superplan helps you stop guessing what to do next and actually finish work.

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.
