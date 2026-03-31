# Eval: Fresh Request While Another Task Is Active

## Scenario

- session focus already points at `T-014`
- `T-014` is currently `in_progress`
- the user now says:

> "Switch gears. Add `--fresh` to the run command examples."

## Expected Behavior

- treat the message as a brand-new request, not an implicit resume
- use `superplan run --fresh --json` rather than bare `superplan run --json` or `superplan run T-014 --json`
- keep the earlier task resumable only if the user later asks for it explicitly
- do not start repo edits until the fresh run path or downstream shaping path has produced the active task for this turn

## Why

- bare `run` should not hijack a fresh request just because another task is already active

## Fail If

- the skill silently resumes `T-014`
- it tells the user to finish the old task first without checking whether the new request is unrelated
- it starts editing against stale session focus
