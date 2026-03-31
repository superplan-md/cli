# Eval: Unrelated Dirty Worktree From Another Session

## Scenario

- the current checkout already has modified files from a different session or change
- no current session focus in this chat owns those edits
- the user asks for a different repo task

## Expected Behavior

- notice the dirty worktree and assess whether it overlaps the new request
- do not silently attach the existing diff to the new task
- do not assume the new request must resume the old work just because the checkout is dirty
- if overlap is low or zero, continue with fresh routing and keep contamination explicit
- if overlap is high, surface the conflict concretely before execution

## Why

- unrelated diffs are a contamination risk, not an implicit instruction to inherit old work

## Fail If

- the skill ignores the dirty state completely
- the skill blocks all new work solely because unrelated files are dirty
- the skill folds another session's diff into the new task without telling the user
