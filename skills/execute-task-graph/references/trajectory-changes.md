# Trajectory Changes

Classify execution discoveries before reacting.

## Local

- implementation detail changes
- task takes a different internal approach
- narrow verifier findings inside the same task

Action:

- stay in execution
- keep the same task contract if it still holds

## Structural

- hidden dependency discovered
- task should split
- task contract no longer fits the real work
- new blocker changes task ordering

Action:

- pause affected work
- route to `shape-work`

## Strategic

- user goal changes
- top-level expectation changes
- engagement or depth decision was materially wrong

Action:

- stop broad execution
- route to `route-work`

## Anti-Patterns

- treating major structural drift as a local execution detail
- verifying against a stale task contract after the trajectory changed materially
- escalating every small implementation surprise into a re-shape event
