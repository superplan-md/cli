# Overlay Production Install Verification

Date: 2026-03-21

## Scope

This verification pass covered the current production-install path for shipping Superplan as one product:

- machine-level CLI install
- packaged overlay companion install metadata and artifact handling
- machine bootstrap of bundled skills
- machine-default overlay opt-in persistence
- overlay auto-launch when work first enters execution
- lifecycle update and cleanup behavior

## Automated Evidence

Commands run from the repo root:

```bash
npm test
npm --prefix apps/overlay-desktop run tauri:check
cargo test --manifest-path apps/overlay-desktop/src-tauri/Cargo.toml
npm run overlay:release
```

Observed evidence:

- `npm test` passed with installer coverage for:
  - CLI-only local source install
  - overlay companion install with machine-default enablement
  - overlay ensure cold-start launch
  - task-start auto-launch of the overlay companion
  - update preserving overlay install configuration
  - remove cleaning managed overlay artifacts
  - stable overlay release packaging outputs for macOS tarballs and Linux AppImage artifacts
- `tauri:check` validates the desktop app's Rust/Tauri shell after the launcher-facing workspace-targeting and single-instance changes
- `cargo test` validates the desktop app's Rust-side runtime resolution and launch-routing tests
- `npm run overlay:release` succeeded on the current macOS arm64 workspace and emitted `dist/release/overlay/superplan-overlay-darwin-arm64.tar.gz`

## Installer Contract

The current user-facing install flow is:

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.sh | sh
```

Current behavior:

- installs the CLI
- installs the packaged overlay companion for the current platform when the release artifact exists
- runs machine-level `superplan setup` automatically
- asks whether the overlay should be enabled by default on this machine
- when enabled, `superplan task new`, `superplan task batch`, `superplan run`, `superplan run <task_ref>`, and `superplan task reopen` auto-reveal the overlay as work becomes visible

## Release Artifact Contract

Current stable artifact names:

- `superplan-overlay-darwin-arm64.tar.gz`
- `superplan-overlay-darwin-x64.tar.gz`
- `superplan-overlay-linux-arm64.AppImage`
- `superplan-overlay-linux-x64.AppImage`

Current release build command:

```bash
npm run overlay:release
```

Output directory:

```text
dist/release/overlay/
```

Current multi-platform release publication command:

```bash
npm run overlay:release:github -- --tag <release-tag>
```

That dispatches the GitHub Actions release workflow so macOS, Linux, and Windows artifacts are built on native runners and uploaded to the requested GitHub release.

## Remaining Caveats

- The curl installer depends on packaged overlay release assets being published for the target ref and platform. The GitHub release workflow now covers macOS, Linux, and Windows publication, but the install flow still degrades gracefully when a specific platform asset is missing for a tag.
- Native fullscreen-space behavior on macOS remains a separate shell acceptance gate. The install flow is wired, but fullscreen visibility still needs platform acceptance verification outside the packaging path.
