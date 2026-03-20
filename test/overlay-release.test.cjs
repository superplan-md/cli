const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { REPO_ROOT } = require('./helpers.cjs');

function runTarList(artifactPath) {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-tzf', artifactPath], (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      resolve(stdout);
    });
  });
}

test('overlay release target resolves stable artifact names for supported platforms', () => {
  const { getOverlayReleaseTarget } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release.js'));

  assert.deepEqual(getOverlayReleaseTarget('darwin', 'x86_64'), {
    platform: 'darwin',
    arch: 'x64',
    artifactName: 'superplan-overlay-darwin-x64.tar.gz',
    artifactKind: 'tar.gz',
    bundleDirectory: 'macos',
    bundleExtension: '.app',
  });

  assert.deepEqual(getOverlayReleaseTarget('linux', 'aarch64'), {
    platform: 'linux',
    arch: 'arm64',
    artifactName: 'superplan-overlay-linux-arm64.AppImage',
    artifactKind: 'file',
    bundleDirectory: 'appimage',
    bundleExtension: '.AppImage',
  });
});

test('overlay release packaging creates a stable macOS tarball from the Tauri app bundle', async () => {
  const { packageOverlayRelease } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release.js'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'superplan-overlay-release-macos-'));
  const bundleRoot = path.join(root, 'bundle');
  const outputDir = path.join(root, 'output');
  const appExecutable = path.join(
    bundleRoot,
    'macos',
    'Superplan Overlay Desktop.app',
    'Contents',
    'MacOS',
    'Superplan Overlay Desktop',
  );

  await fs.mkdir(path.dirname(appExecutable), { recursive: true });
  await fs.writeFile(appExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const result = await packageOverlayRelease({
    platform: 'darwin',
    arch: 'arm64',
    bundleRoot,
    outputDir,
  });
  const tarListing = await runTarList(result.artifactPath);

  assert.equal(path.basename(result.artifactPath), 'superplan-overlay-darwin-arm64.tar.gz');
  assert.match(tarListing, /Superplan Overlay Desktop\.app\/Contents\/MacOS\/Superplan Overlay Desktop/);
});

test('overlay release packaging creates a stable Linux AppImage artifact', async () => {
  const { packageOverlayRelease } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release.js'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'superplan-overlay-release-linux-'));
  const bundleRoot = path.join(root, 'bundle');
  const outputDir = path.join(root, 'output');
  const appImagePath = path.join(bundleRoot, 'appimage', 'Superplan Overlay Desktop_0.1.0_amd64.AppImage');

  await fs.mkdir(path.dirname(appImagePath), { recursive: true });
  await fs.writeFile(appImagePath, 'binary');

  const result = await packageOverlayRelease({
    platform: 'linux',
    arch: 'x64',
    bundleRoot,
    outputDir,
  });

  assert.equal(path.basename(result.artifactPath), 'superplan-overlay-linux-x64.AppImage');
  assert.equal(await fs.readFile(result.artifactPath, 'utf-8'), 'binary');
});
