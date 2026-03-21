const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  REPO_ROOT,
  makeSandbox,
  parseCliJson,
} = require('./helpers.cjs');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: [typeof options.input === 'string' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    if (typeof options.input === 'string' && child.stdin) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

test('install script installs superplan from a local source snapshot into a custom prefix', async () => {
  const sandbox = await makeSandbox('superplan-install-script-');
  const prefixDir = path.join(sandbox.root, 'prefix');

  await fs.mkdir(prefixDir, { recursive: true });

  const installResult = await runCommand('sh', [path.join(REPO_ROOT, 'scripts', 'install.sh')], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      HOME: sandbox.home,
      SUPERPLAN_SOURCE_DIR: REPO_ROOT,
      SUPERPLAN_INSTALL_PREFIX: prefixDir,
      SUPERPLAN_ENABLE_OVERLAY: '0',
    },
  });

  assert.equal(installResult.code, 0, installResult.stderr || installResult.stdout);
  assert.match(installResult.stdout, /Installed Superplan to/);

  const installMetadata = JSON.parse(await fs.readFile(
    path.join(sandbox.home, '.config', 'superplan', 'install.json'),
    'utf-8',
  ));
  assert.equal(installMetadata.install_method, 'local_source');
  assert.equal(installMetadata.install_prefix, prefixDir);
  assert.equal(installMetadata.install_bin, path.join(prefixDir, 'bin'));
  assert.equal(installMetadata.source_dir, REPO_ROOT);
  assert.equal(installMetadata.ref, 'dev');
  assert.equal(await fs.stat(path.join(sandbox.home, '.config', 'superplan', 'config.toml')).then(() => true, () => false), true);
  assert.equal(await fs.stat(path.join(sandbox.home, '.config', 'superplan', 'skills', 'using-superplan', 'SKILL.md')).then(() => true, () => false), true);

  const cliResult = await runCommand(path.join(prefixDir, 'bin', 'superplan'), ['--version', '--json'], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      HOME: sandbox.home,
    },
  });

  assert.equal(cliResult.code, 0, cliResult.stderr || cliResult.stdout);
  const payload = parseCliJson(cliResult);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.version, '0.1.0');
});

test('install script records and installs a bundled overlay companion when one is provided', async () => {
  const sandbox = await makeSandbox('superplan-install-overlay-');
  const prefixDir = path.join(sandbox.root, 'prefix');
  const overlaySourcePath = path.join(sandbox.root, 'overlay-bin');

  await fs.mkdir(prefixDir, { recursive: true });
  await fs.writeFile(overlaySourcePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const installResult = await runCommand('sh', [path.join(REPO_ROOT, 'scripts', 'install.sh')], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      HOME: sandbox.home,
      SUPERPLAN_SOURCE_DIR: REPO_ROOT,
      SUPERPLAN_INSTALL_PREFIX: prefixDir,
      SUPERPLAN_OVERLAY_SOURCE_PATH: overlaySourcePath,
      SUPERPLAN_ENABLE_OVERLAY: '1',
    },
  });

  assert.equal(installResult.code, 0, installResult.stderr || installResult.stdout);
  assert.match(installResult.stdout, /Installed Superplan overlay to/);

  const installMetadata = JSON.parse(await fs.readFile(
    path.join(sandbox.home, '.config', 'superplan', 'install.json'),
    'utf-8',
  ));
  const expectedOverlayInstallPath = path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay', path.basename(overlaySourcePath));

  assert.equal(installMetadata.overlay.install_method, 'copied_prebuilt');
  assert.equal(installMetadata.overlay.source_path, overlaySourcePath);
  assert.equal(installMetadata.overlay.install_dir, path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay'));
  assert.equal(installMetadata.overlay.install_path, expectedOverlayInstallPath);
  assert.equal(installMetadata.overlay.executable_path, expectedOverlayInstallPath);
  assert.match(
    await fs.readFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'utf-8'),
    /\[overlay\][\s\S]*enabled = true/,
  );
});

test('install script defaults bundled overlay installs to enabled', async () => {
  const installerSource = await fs.readFile(path.join(REPO_ROOT, 'scripts', 'install.sh'), 'utf-8');

  assert.match(
    installerSource,
    /SUPERPLAN_ENABLE_OVERLAY="\$\{SUPERPLAN_ENABLE_OVERLAY:-1\}"/,
  );
});
