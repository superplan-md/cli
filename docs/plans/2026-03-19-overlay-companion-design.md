# Overlay Companion Design

## Summary

This document captures the approved technical design for a desktop overlay companion for Superplan. The product shape is a single floating translucent overlay window that shows the current task, plays sound for high-signal events, and expands into a read-only kanban view when clicked.

The current TypeScript CLI remains the source of truth for task state and task transitions. The desktop app is a companion surface, not a second task engine.

## Goals

- Provide a true overlay that floats above other apps on macOS and Linux.
- Keep the compact view visible and interactive while the user works in other apps.
- Expand the same window into a larger translucent kanban view.
- Play sound only for `needs_feedback` and `all_tasks_done`.
- Avoid requiring a login daemon or persistent background service.
- Preserve a single user-facing install flow.

## Non-Goals

- Editing task state from the overlay in v1.
- Reserving desktop space for the overlay.
- Supporting Windows in v1.
- Guaranteeing identical overlay behavior across every Linux compositor.
- Replacing the CLI as the main product entry point.

## Product Decisions

### Window Model

- One native window with two modes: `compact` and `expanded`.
- The compact mode is always-on-top, translucent, interactive, and wide enough to show one active task.
- Clicking the compact mode expands the same window into a larger translucent kanban overlay.
- Dismissing the expanded mode shrinks the same window back to compact mode.

### Attention Model

- Sound is always enabled in product UX.
- Sound plays only for:
  - `needs_feedback`
  - `all_tasks_done`
- `needs_feedback` is the handoff event when the agent requires user action.
- `all_tasks_done` signals that the current session graph is exhausted and the user should decide what to do next.

### Lifecycle Model

- The overlay is launched by skills or CLI commands.
- The overlay is not a login item, daemon, or always-running background service.
- The overlay remains alive as a foreground app process only while a task session is active.
- The CLI may relaunch the overlay on demand if the user closes it during an active session.

## Options Considered

### Option 1: Tauri Companion App

Build a separate Tauri desktop companion while keeping the existing CLI as the task engine.

Pros:

- Small packaged app footprint.
- Good fit for a CLI-first product.
- Supports transparent frameless windows, notifications, and native packaging.
- Clean single-install distribution through `.dmg` and `AppImage`.

Cons:

- Linux overlay behavior varies by compositor, especially on Wayland.
- Some transparency behaviors on macOS rely on platform-specific support and should be treated carefully for future distribution constraints.

### Option 2: Electron Companion App

Build the same companion architecture with Electron instead of Tauri.

Pros:

- More mature and battle-tested windowing behavior.
- More confidence for aggressive top-level overlay behavior.

Cons:

- Larger install size.
- Heavier runtime for a small companion surface.
- Worse fit for the repo's current lightweight CLI shape.

### Option 3: Browser or Web UI Only

Use a local web UI or browser tab without a desktop shell.

Pros:

- Lowest implementation complexity.

Cons:

- Cannot provide a true always-on-top overlay.
- Cannot provide the expected native desktop behavior.

## Recommendation

Use Tauri for v1, with the CLI retained as the source of truth. Treat Linux overlay behavior as supported but compositor-sensitive, and validate it with an early prototype before committing to the full product surface.

If Tauri proves insufficient for overlay reliability during prototyping, reassess Electron specifically for the desktop shell while keeping the same CLI-driven architecture.

## Architecture

### Repo Shape

Recommended structure:

- `src/cli/...` remains the current CLI.
- `apps/overlay-desktop/` contains the Tauri companion app.
- `packages/shared-state/` optionally contains shared TypeScript types for snapshot payloads and event schemas.

The repo stays unified. There is no need to split the product into separate repositories.

### Ownership Boundaries

The CLI owns:

- Task graph state
- Task transitions
- Session lifecycle
- Emitting runtime snapshots and event payloads

The desktop app owns:

- Window management
- Compact and expanded presentation
- Sound playback
- Native notifications
- Watching runtime snapshots
- Rendering board state and attention states

## Process Model

The overlay is a normal app process launched on demand by the CLI.

Recommended commands:

- `superplan overlay ensure`
- `superplan overlay hide`
- `superplan overlay show`

Recommended behavior:

- `superplan run` or the relevant skill flow calls `superplan overlay ensure` near session start.
- The overlay app is single-instance.
- The app stays alive for the current session unless the user closes it.
- If the user closes it, later CLI commands may relaunch it when relevant.

This avoids:

- A background daemon
- A local HTTP service that must remain alive
- Splitting task logic across CLI and UI

## Windowing Model

### Compact Mode

- Fixed position near a screen edge.
- Frameless.
- Transparent/translucent.
- Always-on-top.
- Interactive, not click-through.
- Large enough to display one task title and status.

### Expanded Mode

- Same window grows into a larger kanban surface.
- Remains translucent but with stronger focus treatment.
- Presents read-only task columns including `in_progress`, `backlog`, and `done`.
- Can also surface `blocked` and `needs_feedback` if useful in the same board.

### Platform Notes

macOS is expected to provide the strongest initial implementation quality.

Linux is feasible, but the following must be treated as first-class risks:

- Wayland limits on global window positioning
- Compositor-specific z-order behavior
- Transparency and focus quirks across GNOME and KDE

The product should target Linux support with explicit compositor testing rather than assuming uniform behavior.

## CLI-to-Overlay Communication

Use snapshot files plus file watching for v1.

Do not use a long-lived local HTTP server in v1.

### Snapshot Strategy

- Each workspace gets a runtime state location.
- The CLI writes one canonical JSON snapshot whenever task state changes.
- The desktop overlay watches the snapshot file and renders from the latest contents.
- The overlay remains read-only and does not mutate task state directly in v1.

### Suggested Snapshot Shape

```json
{
  "workspace_path": "/abs/path/to/repo",
  "session_id": "session-123",
  "updated_at": "2026-03-19T21:30:00Z",
  "active_task": {
    "task_id": "T-12",
    "title": "Build overlay prototype",
    "status": "in_progress"
  },
  "board": {
    "in_progress": [],
    "backlog": [],
    "done": [],
    "blocked": [],
    "needs_feedback": []
  },
  "attention_state": "normal",
  "events": [
    {
      "id": "evt-1",
      "kind": "needs_feedback",
      "created_at": "2026-03-19T21:29:00Z"
    }
  ]
}
```

### Event Handling

The overlay should not infer sound playback by diffing task state alone. The CLI should emit explicit event records.

Recommended event kinds:

- `needs_feedback`
- `all_tasks_done`

The overlay should:

- play sound once for new event ids
- remember consumed event ids locally in app state
- avoid mutating the canonical CLI snapshot

## Session Boundary

`all_tasks_done` must only be emitted when:

- the current session is active
- there are no remaining actionable tasks
- no internal automatic follow-up or fix loop is still pending

This logic belongs in the CLI. The overlay should consume the event, not derive it.

## Notifications and Sound

### Sound Policy

Only two sounds are allowed in v1:

- `needs_feedback`
- `all_tasks_done`

The sounds should be different so the user can distinguish them without looking at the screen.

### Notification Policy

- Use native desktop notifications for the same high-signal events.
- Treat sound as primary and notifications as supporting signal.
- Avoid alerts for routine transitions such as start, resume, block, or internal state churn.

## Packaging and Distribution

This should remain a single user-facing install flow.

Recommended packaging:

- macOS: bundled app distributed as `.dmg`
- Linux: bundled app distributed as `AppImage`

The release should contain both:

- the CLI
- the desktop overlay companion

The product can remain CLI-led for development and internal use, while release packaging presents a single installable artifact to users.

## Prototype Plan

Before full UX implementation, build a minimal Tauri prototype that proves the critical windowing assumptions.

Prototype scope:

- one translucent always-on-top window
- compact and expanded states
- file-watch driven updates from a mock snapshot
- explicit sound playback
- native notification support

Prototype acceptance criteria:

- Works cleanly on macOS
- Works acceptably on at least one Linux Wayland environment
- Works acceptably on at least one Linux X11 environment
- Maintains overlay presence while the user interacts with other apps
- Plays sounds exactly once per explicit event id

## Open Risks

- Linux compositor behavior may force per-environment fallbacks.
- Fullscreen-over-fullscreen behavior may not be identical across platforms.
- Packaging may need extra hardening for media playback on Linux depending on chosen sound implementation.
- The exact session lifecycle rules for relaunching or suppressing the overlay need to be codified in the CLI.

## Next Step

Create a concrete implementation plan that covers:

- repo structure changes
- new CLI commands
- runtime snapshot schema and storage location
- shared type definitions
- Tauri app scaffold and window management
- sound and notification implementation
- packaging and release integration
- prototype milestones and verification criteria
