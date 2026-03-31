# Release Checklist

This is the unsigned-first release path for Superplan.

It publishes the CLI install scripts from GitHub and uploads packaged Electron overlay artifacts to a GitHub release. Users can install from the public README commands after this completes.

## Preconditions

1. `apps/desktop` is tracked in git and committed.
2. The branch you plan to release from is pushed to GitHub.
3. The full suite is green:
   - `npm test`
   - `pnpm --dir apps/desktop run typecheck`
4. The public installer scripts on `main` point at the same repo you are releasing from.

## Publish

1. Merge or push the release-ready changes to `main`.
2. Create and push a tag:

```bash
git tag v0.x.y
git push origin v0.x.y
```

3. Dispatch the native overlay build and upload:

```bash
npm run overlay:release:github -- --tag v0.x.y --repo superplan-md/superplan-plugin --publish
```

That workflow builds native artifacts on GitHub-hosted runners and uploads them to the GitHub release for `v0.x.y`.

## Verify The Release

Confirm the GitHub release contains the expected assets for the platforms you support:

- `superplan-overlay-darwin-x64.tar.gz`
- `superplan-overlay-darwin-arm64.tar.gz`
- `superplan-overlay-linux-x64.AppImage`
- `superplan-overlay-windows-x64.exe`

Each uploaded artifact should also have a matching checksum file:

- `*.sha256`

Then smoke-test the public install path from a clean machine or sandbox:

```bash
curl -fsSL https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.sh | sh
```

On Windows PowerShell:

```powershell
curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/superplan-plugin/main/scripts/install.cmd; if ($LASTEXITCODE -eq 0) { .\install-superplan.cmd }
```

## Expected Unsigned Warnings

This release flow does not include Apple notarization or Windows code signing yet.

- macOS users will see Gatekeeper friction.
- Windows users will see SmartScreen friction.

That is acceptable for the first open-source release, but it should be treated as follow-up release hardening rather than the final distribution state.
