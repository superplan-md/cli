# Eval: Interrupted Session Followed By A Different Request

## Scenario

- earlier in the same chat, a tracked task was interrupted or parked in `needs_feedback`
- the user never answered that blocker
- the next message is:

> "Leave that for now. Document the deployment env vars instead."

## Expected Behavior

- do not treat the unanswered interruption as the current intent
- preserve the interrupted task as waiting for feedback
- start the new request through the fresh-request path rather than the interrupted task's resume path
- only ask for the older feedback if the new request actually depends on it

## Why

- same chat does not mean same intent

## Fail If

- the skill keeps trying to resume the interrupted task
- it frames the new request as impossible until the old feedback loop is resolved
- it treats "same chat" as authority to ignore the user's new request
