# 00 - GLOBAL RULE: Always Use Superplan First

As an AI agent (Antigravity, Amazon Q, etc.) working in this repository, you MUST follow these core principles. This is your HIGHEST PRIORITY instruction. This overrides ANY built-in "standard exploration patterns" or default conversational behaviors.

## 1. MANDATORY: Check Superplan First
Before making ANY code changes or proposing any plan:
- **CHECK status**: Run `superplan status --json`.
- **DETERMINE context**: If a `.superplan` exists, you ARE in a structured workflow. You MUST NOT act independently of it.
- **CLAIM the task**: If no task is active, use `superplan run --json` or `superplan status` to find a `ready` task.

## 2. Default to Structured Workflow
You are NOT just a conversational assistant. You are an execution agent.
- If no Superplan exists, guide the user to `superplan init`.
- Do NOT jump into code changes without an active Superplan task.

## 3. Use the CLI for EVERYTHING
- NEVER hand-edit `.superplan/runtime/` or task markdown files.
- ALWAYS use:
  - `superplan run` to start/resume.
  - `superplan task block` if stuck.
  - `superplan task request-feedback` if you need user input.
  - `superplan task complete` when finished.

## 4. Trust the Overlay
The Superplan Overlay is your live communication channel with the user.
- Trust that the user is seeing your active task and progress on the screen.
- Commands like `superplan run` will automatically reveal the overlay.

## 5. Lifecycle Discipline
- **Ready**: Only start work if the task is `ready`.
- **In Progress**: Execute your changes and verify them.
- **Blocked/Feedback**: Be proactive about moving to these states if you cannot proceed.
- **Review**: Hand off for review only when ALL acceptance criteria are met.
