const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const {
  REPO_ROOT,
  getSuperplanRoot,
} = require('./helpers.cjs');

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
    bundleExtension: '.app',
  });

  assert.deepEqual(getOverlayReleaseTarget('linux', 'aarch64'), {
    platform: 'linux',
    arch: 'arm64',
    artifactName: 'superplan-overlay-linux-arm64.AppImage',
    artifactKind: 'file',
    bundleExtension: '.AppImage',
  });

  assert.deepEqual(getOverlayReleaseTarget('win32', 'amd64'), {
    platform: 'windows',
    arch: 'x64',
    artifactName: 'superplan-overlay-windows-x64.exe',
    artifactKind: 'file',
    bundleExtension: '.exe',
  });
});

test('overlay release packaging creates a stable macOS tarball from the Electron app bundle', async () => {
  const { packageOverlayRelease } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release.js'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'superplan-overlay-release-macos-'));
  const bundleRoot = path.join(root, 'dist');
  const outputDir = path.join(root, 'output');
  const appPath = path.join(bundleRoot, 'mac-arm64', 'Superplan.app');
  const appExecutable = path.join(
    appPath,
    'Contents',
    'MacOS',
    'Superplan',
  );
  const infoPlistPath = path.join(appPath, 'Contents', 'Info.plist');
  const iconPath = path.join(appPath, 'Contents', 'Resources', 'icon.icns');

  await fs.mkdir(path.dirname(appExecutable), { recursive: true });
  await fs.writeFile(appExecutable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await fs.mkdir(path.dirname(iconPath), { recursive: true });
  await fs.writeFile(iconPath, 'icon');
  await fs.writeFile(infoPlistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleExecutable</key>
    <string>Superplan</string>
    <key>CFBundleIdentifier</key>
    <string>com.superplan.test.overlay-release</string>
    <key>CFBundleName</key>
    <string>Superplan</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
  </dict>
</plist>
`);

  const result = await packageOverlayRelease({
    platform: 'darwin',
    arch: 'arm64',
    bundleRoot,
    outputDir,
  });
  const tarListing = await runTarList(result.artifactPath);

  assert.equal(path.basename(result.artifactPath), 'superplan-overlay-darwin-arm64.tar.gz');
  assert.equal(path.basename(result.checksumPath), 'superplan-overlay-darwin-arm64.tar.gz.sha256');
  assert.match(await fs.readFile(result.checksumPath, 'utf-8'), /^[a-f0-9]{64}  superplan-overlay-darwin-arm64\.tar\.gz$/m);
  assert.match(tarListing, /Superplan\.app\/Contents\/MacOS\/Superplan/);
  if (process.platform === 'darwin') {
    assert.match(tarListing, /Superplan\.app\/Contents\/_CodeSignature\/CodeResources/);
  }
});

test('overlay release packaging creates a stable Linux AppImage artifact', async () => {
  const { packageOverlayRelease } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release.js'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'superplan-overlay-release-linux-'));
  const bundleRoot = path.join(root, 'dist');
  const outputDir = path.join(root, 'output');
  const appImagePath = path.join(bundleRoot, 'superplan-desktop-1.0.0.AppImage');

  await fs.mkdir(path.dirname(appImagePath), { recursive: true });
  await fs.writeFile(appImagePath, 'binary');

  const result = await packageOverlayRelease({
    platform: 'linux',
    arch: 'x64',
    bundleRoot,
    outputDir,
  });

  assert.equal(path.basename(result.artifactPath), 'superplan-overlay-linux-x64.AppImage');
  assert.equal(path.basename(result.checksumPath), 'superplan-overlay-linux-x64.AppImage.sha256');
  assert.match(await fs.readFile(result.checksumPath, 'utf-8'), /^[a-f0-9]{64}  superplan-overlay-linux-x64\.AppImage$/m);
  assert.equal(await fs.readFile(result.artifactPath, 'utf-8'), 'binary');
});

test('overlay release packaging creates a stable Windows executable artifact', async () => {
  const { packageOverlayRelease } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release.js'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'superplan-overlay-release-windows-'));
  const bundleRoot = path.join(root, 'dist');
  const outputDir = path.join(root, 'output');
  const binaryPath = path.join(bundleRoot, 'superplan-desktop-1.0.0-portable.exe');

  await fs.mkdir(bundleRoot, { recursive: true });
  await fs.writeFile(binaryPath, 'windows-binary');

  const result = await packageOverlayRelease({
    platform: 'win32',
    arch: 'amd64',
    bundleRoot,
    outputDir,
  });

  assert.equal(path.basename(result.artifactPath), 'superplan-overlay-windows-x64.exe');
  assert.equal(path.basename(result.checksumPath), 'superplan-overlay-windows-x64.exe.sha256');
  assert.match(await fs.readFile(result.checksumPath, 'utf-8'), /^[a-f0-9]{64}  superplan-overlay-windows-x64\.exe$/m);
  assert.equal(await fs.readFile(result.artifactPath, 'utf-8'), 'windows-binary');
});
