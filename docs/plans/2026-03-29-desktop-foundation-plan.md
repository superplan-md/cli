# Desktop Foundation Plan

Date: 2026-03-29

## Scope

This document defines the first implementation sequence for the Electron desktop app under [apps/desktop](/Users/puneetbhatt/cli/apps/desktop).

The goal is not to add every framework immediately. The goal is to establish a defensible desktop architecture first, then add state, persistence, layout, and regression tooling in an order that reduces avoidable rework.

## Current State

The desktop app currently provides:

- Electron shell with macOS-native titlebar behavior
- preload bridge stub
- renderer mounted as a blank shell
- native macOS vibrancy setup
- core desktop runtime dependencies for state, validation, motion, layout, and durable config
- shared desktop contract and typed preload bridge for config, layout, and app events
- schema-validated IPC payloads and a future-facing workspace snapshot schema family
- durable main-process config and layout persistence through `electron-store`
- focused renderer state stores for config, layout, and session/event state
- split-panel shell primitives in the renderer using `react-resizable-panels`

The desktop app does not yet provide:

- typed IPC contracts
- app config persistence
- renderer state management
- persisted panel layout
- regression tooling specific to the desktop renderer
- project-local desktop-oriented skills

## Architecture Decisions

### Process Boundaries

`main`

- owns privileged APIs and OS integration
- owns window lifecycle, native appearance, app-level menus, filesystem access, and process orchestration
- owns durable app configuration through a main-process persistence layer
- validates all inbound renderer requests before acting on them

`preload`

- exposes a narrow typed API surface to the renderer via `contextBridge`
- translates renderer calls into IPC requests
- does not contain business logic beyond marshaling, event subscription, and guardrails
- is the only renderer-adjacent layer allowed to talk to Electron primitives directly

`renderer`

- owns view composition, user interaction, transient UI state, and layout state
- never imports Electron or Node APIs directly
- never reads or writes persisted config except through the preload API
- treats the preload bridge as the boundary to privileged behavior

### State Ownership

Renderer-local state:

- active panel selection
- local command/search UI state
- temporary filter/sort state
- drag state, resize state, transient animation state

Renderer-persisted state:

- panel sizes and collapsed/expanded state
- last-opened sections within the app
- user UI preferences that are local to the desktop app shell

Main-process durable state:

- workspace preferences
- desktop feature flags
- persisted theme/config mode
- saved layout presets
- future machine-level desktop settings

Runtime event state:

- task progress streaming from CLI/runtime into the desktop app
- task lifecycle updates
- overlay-style visibility state for active work

Runtime event state should be modeled as event-driven session data, not as durable config.

### Persistence Rules

Use two persistence tiers:

1. Renderer persistence for low-risk local UI restoration.
2. Main-process persistence for durable app configuration and any state that needs schema/version control.

Rules:

- panel split ratios can use component-level persistence for fast iteration
- saved named layouts must be stored in the main process
- persisted values must be versioned and schema-validated
- renderer code must not write directly to disk or ad hoc browser storage for important settings

### IPC Rules

All IPC must follow these constraints:

- typed channel names
- `zod` validation on both request and response shapes where practical
- explicit separation between commands and subscriptions
- no generic `invoke("anything", payload)` patterns
- no pass-through file or shell access from renderer to main

### Testing Rules

Desktop development needs three levels of protection:

1. Type-level safety for preload and IPC contracts.
2. Renderer tests for component logic, stores, and layout behavior.
3. End-to-end regression checks for window behavior and visual layout.

This is required because AI-assisted edits will increase the chance of subtle regressions in state, persistence, and layout.

## Task Breakdown

### Phase 1: Foundations

1. Define the desktop app architecture.
   Document main/preload/renderer responsibilities, state ownership, and persistence rules.
   Status: complete.

2. Add core runtime dependencies.
   Install `zustand`, `zod`, `motion`, `react-resizable-panels`, and `electron-store`.
   Status: complete.

3. Set up typed IPC and preload APIs.
   Create a narrow bridge for config, layout persistence, and app events.
   Status: complete.

4. Add schema validation for cross-process data.
   Validate IPC payloads, persisted config, and future desktop-runtime event envelopes.
   Status: complete.

5. Implement durable app config in the main process.
   Add `electron-store` with schema/versioning and typed config accessors.
   Status: complete.

### Phase 2: Shell and Layout

6. Implement renderer state with Zustand.
   Separate shell state, session state, and layout state into focused stores.
   Status: complete.

7. Add split-panel layout primitives.
   Introduce `react-resizable-panels` for IDE-like shell composition.
   Status: complete.

8. Define layout persistence.
   Persist panel sizes and collapsed state with explicit keys and migration/version handling.
   Status: complete.

9. Build the first real desktop shell.
   Replace the empty renderer with navigation, workspace, and secondary panel regions.
   Status: complete.

10. Add motion where it improves clarity.
    Use `motion` for panel transitions and state changes, not for routine hover styling.

### Phase 3: Regression Control

11. Add renderer test infrastructure.
    Set up `vitest` and `@testing-library/react`.

12. Add end-to-end and visual regression coverage.
    Set up `playwright` for core flows and screenshot baselines.

13. Add AI-change guardrails.
    Enforce typecheck, lint, unit tests, and desktop smoke checks before claiming changes are safe.

### Phase 4: Agent Ergonomics

14. Add project-local desktop skills.
    Add local guidance for Electron security, React composition, shadcn usage, verification, and UI review.

15. Document the operating model.
    Add a short desktop architecture document for future contributors and agents.

## Recommended Dependency Set

Add now:

- `zustand`
- `zod`
- `motion`
- `react-resizable-panels`
- `electron-store`

Installed for the desktop app:

- `zustand`
- `zod`
- `motion`
- `react-resizable-panels`
- `electron-store`

Add with testing phase:

- `vitest`
- `@testing-library/react`
- `@testing-library/user-event`
- `playwright`

Do not add yet:

- Remotion-specific rendering dependencies
- additional state libraries beyond `zustand`
- renderer-side direct persistence libraries for durable app config

## Recommended Skills

Required:

- shadcn/ui component workflow
- React best practices
- React composition patterns
- frontend design review
- web design guidelines
- Playwright testing
- Electron-specific desktop guidance

Deferred:

- Remotion/video rendering guidance until video export becomes a product requirement

## Exit Criteria For Task 1

Task 1 is complete when:

- process boundaries are explicit
- persistence ownership is explicit
- IPC constraints are explicit
- the 15-task implementation sequence is fixed in-repo

This document satisfies that requirement.

## Verification

Task 2 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- desktop typecheck passed
- Electron renderer and main/preload bundles built successfully after adding the dependency baseline

Task 3 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- shared desktop contract compiles across main, preload, and renderer
- typed preload bridge exposes config, layout, and task-stream event APIs
- Electron renderer and main/preload bundles built successfully after wiring IPC handlers

Task 4 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- current config, layout, and task-stream IPC payloads are validated with shared `zod` schemas
- a future workspace snapshot schema family exists for the upcoming CLI-to-desktop data contract
- Electron renderer and main/preload bundles built successfully after schema wiring

Task 5 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- desktop config and layout state are persisted in the main process through `electron-store`
- the preload and IPC surface remained stable while storage moved out of process memory
- Electron renderer and main/preload bundles built successfully after the persistence change

Task 6 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- renderer state is split into focused Zustand stores for config, layout, and session/event data
- renderer bootstrap pulls initial state from the preload bridge and subscribes to task-stream events
- Electron renderer and main/preload bundles built successfully after adding the state layer

Task 7 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- the renderer shell now uses `react-resizable-panels` primitives for a three-region layout
- resize handles and panel structure are present without introducing layout persistence coupling yet
- Electron renderer and main/preload bundles built successfully after adding shell layout primitives

Task 8 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- the shell layout model was reduced to the intended two-panel structure: sidebar and main content
- panel split sizes now persist through the existing desktop layout bridge and main-process storage
- Electron renderer and main/preload bundles built successfully after wiring two-panel layout persistence

Task 9 verification evidence:

```bash
pnpm --dir apps/desktop build
```

Observed result:

- the renderer now presents a real two-panel shell with a sidebar and a main workspace surface
- the shell consumes current config, layout, and session state instead of placeholder labels only
- Electron renderer and main/preload bundles built successfully after the shell implementation
