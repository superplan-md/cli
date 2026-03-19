# Stay-Out Cases

Stay out when structure would be ceremonial.

## Clear Stay-Out Cases

- simple explanations
- casual conversation
- summarization with no durable workflow value
- one-shot advice where no artifact, visibility, or tracking benefit exists
- code reading questions where the answer itself is the deliverable

## Looks Important But Should Still Stay Out

- "Can you explain the tradeoffs between these two approaches?"
- "What is this architecture doing?"
- "Tell me if this API naming feels right."

These may be high-signal conversations, but if the answer itself is the deliverable, routing into Superplan adds no value.

## Looks Tiny But Should Usually Engage

- a typo or docs fix that should still appear in execution visibility
- a one-file config fix where a lightweight tracked unit prevents silent drift
- a tiny code edit the user expects to be performed, not merely discussed

These often belong in `direct`, not `stay_out`.

## Ambiguous Cases

- tiny typo fixes
- very small bug reports
- quick docs edits where the doc itself may be the full deliverable
- a "quick fix" request in a brownfield repo with poor local context

For ambiguous cases:

- prefer the smallest useful depth
- but do not choose `stay_out` if real work is expected and a lightweight trace would help

## Rule Of Thumb

Ask:

- would a durable artifact help later visibility?
- would lack of tracking make the work effectively invisible?
- is the user asking for work to be done, or only for understanding?

If the answer is understanding only, stay out.
