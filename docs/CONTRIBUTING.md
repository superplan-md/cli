# Superplan Contributing & Internals

Detailed documentation for developers and power users.

## Advanced Installation

### Install with custom prefix
```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/alpha.4/scripts/install.sh | SUPERPLAN_REF=alpha.4 SUPERPLAN_INSTALL_PREFIX="$HOME/.local" sh
```

### Run from source
1. `npm install`
2. `npm run build`
3. `node dist/cli/main.js init`

## Development

### Testing
- `npm test`: Full suite.
- `node --test test/cli.test.cjs`: Focused CLI check.

### Overlay Packaging
```bash
npm run overlay:release
```
Emits a packaged artifact for the current host platform to `dist/release/overlay/`.

### Overlay GitHub Releases
```bash
npm run overlay:release:github -- --tag <release-tag>
```
Dispatches the GitHub Actions matrix release workflow, which builds native overlay artifacts for macOS, Linux, and Windows on matching runners and uploads them to the requested GitHub release tag.

## Internals

### Task Contracts
Tasks live in `~/.config/superplan/changes/<slug>/tasks/T-xxx.md`.
Required sections: `## Description`, `## Acceptance Criteria`.

### Runtime Model
- `~/.config/superplan/runtime/tasks.json`: Execution state.
- `~/.config/superplan/runtime/events.ndjson`: Event log.

### Visibility Reports
`superplan visibility report --json` groups runtime events into run boundaries and writes reports to `~/.config/superplan/runtime/reports/`.
