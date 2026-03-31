const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const {
  REPO_ROOT,
  makeSandbox,
  parseCliJson,
  getSuperplanRoot,
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

async function waitForPidExit(pid, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      process.kill(pid, 0);
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      if (error && error.code === 'ESRCH') {
        return;
      }

      throw error;
    }
  }

  throw new Error(`Timed out waiting for process ${pid} to exit`);
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
      SUPERPLAN_RUN_SETUP_AFTER_INSTALL: '1',
    },
  });

  assert.equal(installResult.code, 0, `install.sh failed with code ${installResult.code}\nSTDOUT: ${installResult.stdout}\nSTDERR: ${installResult.stderr}`);
  assert.match(installResult.stdout, /Installed Superplan to/);
  assert.doesNotMatch(installResult.stdout, /npm notice/i);

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
  assert.equal(await fs.stat(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry', 'SKILL.md')).then(() => true, () => false), true);

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
      SUPERPLAN_RUN_SETUP_AFTER_INSTALL: '1',
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

test('install script skips setup cleanly when requested and ends with a clear next step', async () => {
  const sandbox = await makeSandbox('superplan-install-no-setup-');
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
      SUPERPLAN_RUN_SETUP_AFTER_INSTALL: '0',
    },
  });

  assert.equal(installResult.code, 0, installResult.stderr || installResult.stdout);
  assert.match(installResult.stdout, /Installation successful\./);
  assert.match(installResult.stdout, /Please cd into your favorite repo and run: superplan init/);
  assert.doesNotMatch(installResult.stdout, /npm notice/i);
  assert.equal(await fs.stat(path.join(sandbox.home, '.config', 'superplan', 'config.toml')).then(() => true, () => false), false);

  const installMetadata = JSON.parse(await fs.readFile(
    path.join(sandbox.home, '.config', 'superplan', 'install.json'),
    'utf-8',
  ));
  assert.equal(installMetadata.setup_completed, false);
});

test('install script defaults bundled overlay installs to enabled', async () => {
  const installerSource = await fs.readFile(path.join(REPO_ROOT, 'scripts', 'install.sh'), 'utf-8');

  assert.match(
    installerSource,
    /SUPERPLAN_ENABLE_OVERLAY="\$\{SUPERPLAN_ENABLE_OVERLAY:-1\}"/,
  );
});

test('install script resolves the latest GitHub release when no ref is pinned', async () => {
  const installerSource = await fs.readFile(path.join(REPO_ROOT, 'scripts', 'install.sh'), 'utf-8');

  assert.match(
    installerSource,
    /SUPERPLAN_REF="\$\{SUPERPLAN_REF:-\}"/,
  );
  assert.match(
    installerSource,
    /releases\/latest/,
  );
  assert.match(
    installerSource,
    /Resolved latest Superplan overlay release:/,
  );
});

test('windows installer scripts are packaged and documented', async () => {
  const packageJson = JSON.parse(await fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
  const readme = await fs.readFile(path.join(REPO_ROOT, 'README.md'), 'utf-8');

  assert.ok(packageJson.files.includes('scripts/install.ps1'));
  assert.ok(packageJson.files.includes('scripts/install.cmd'));
  assert.ok(
    readme.includes('curl.exe -fsSL -o install-superplan.cmd https://raw.githubusercontent.com/superplan-md/cli/main/scripts/install.cmd; if ($LASTEXITCODE -eq 0) { .\\install-superplan.cmd }'),
  );
  assert.match(readme, /install-superplan\.cmd/);
  assert.match(readme, /Windows installer now installs the CLI and the packaged overlay companion/i);
});

test('windows powershell installer resolves the latest release and overlay artifact metadata', async () => {
  const installerSource = await fs.readFile(path.join(REPO_ROOT, 'scripts', 'install.ps1'), 'utf-8');

  assert.match(installerSource, /Resolve-LatestReleaseTagFromGitHub/);
  assert.match(installerSource, /SUPERPLAN_REF/);
  assert.match(installerSource, /platform = 'windows'/);
  assert.match(installerSource, /Resolve-OverlayReleaseTarget/);
  assert.match(installerSource, /Resolved latest Superplan overlay release:/);
  assert.match(installerSource, /Installed Superplan overlay to/);
  assert.match(installerSource, /Run `superplan init` in/);
  assert.match(installerSource, /Enable desktop overlay by default on this machine\? \[Y\/n\]/);
  assert.match(installerSource, /overlay enable --global --json/);
  assert.match(installerSource, /overlay disable --global --json/);
  assert.match(installerSource, /Installation successful\./);
});

test('windows cmd installer delegates to powershell', async () => {
  const installerSource = await fs.readFile(path.join(REPO_ROOT, 'scripts', 'install.cmd'), 'utf-8');

  assert.match(installerSource, /install\.ps1/);
  assert.match(installerSource, /powershell -NoProfile -ExecutionPolicy Bypass/);
  assert.match(installerSource, /raw\.githubusercontent\.com\/superplan-md\/cli\/main\/scripts\/install\.ps1/);
  assert.match(installerSource, /Invoke-WebRequest -UseBasicParsing/);
  assert.match(installerSource, /-OutFile/);
  assert.match(installerSource, /-File "%TEMP_PS1%"/);
  assert.doesNotMatch(installerSource, /Invoke-Expression/);
});

test('install script stops a running installed overlay before replacing it', async () => {
  const sandbox = await makeSandbox('superplan-install-overlay-replace-');
  const prefixDir = path.join(sandbox.root, 'prefix');
  const overlaySourcePath = path.join(sandbox.root, 'overlay-bin');

  await fs.mkdir(prefixDir, { recursive: true });
  await fs.writeFile(overlaySourcePath, '#!/bin/sh\nwhile :; do sleep 60; done\n', { mode: 0o755 });

  const installEnv = {
    ...process.env,
    HOME: sandbox.home,
    SUPERPLAN_SOURCE_DIR: REPO_ROOT,
    SUPERPLAN_INSTALL_PREFIX: prefixDir,
    SUPERPLAN_OVERLAY_SOURCE_PATH: overlaySourcePath,
    SUPERPLAN_ENABLE_OVERLAY: '0',
    SUPERPLAN_RUN_SETUP_AFTER_INSTALL: '0',
  };

  const firstInstall = await runCommand('sh', [path.join(REPO_ROOT, 'scripts', 'install.sh')], {
    cwd: sandbox.cwd,
    env: installEnv,
  });

  assert.equal(firstInstall.code, 0, firstInstall.stderr || firstInstall.stdout);

  const installedOverlayPath = path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay', 'overlay-bin');
  const runningOverlay = spawn(installedOverlayPath, [], {
    cwd: sandbox.cwd,
    env: {
      ...process.env,
      HOME: sandbox.home,
    },
    detached: true,
    stdio: 'ignore',
  });
  runningOverlay.unref();

  assert.ok(runningOverlay.pid, 'expected spawned overlay pid');
  await new Promise(resolve => setTimeout(resolve, 250));
  process.kill(runningOverlay.pid, 0);

  await fs.writeFile(overlaySourcePath, '#!/bin/sh\nprintf replaced\n', { mode: 0o755 });

  const secondInstall = await runCommand('sh', [path.join(REPO_ROOT, 'scripts', 'install.sh')], {
    cwd: sandbox.cwd,
    env: installEnv,
  });

  assert.equal(secondInstall.code, 0, secondInstall.stderr || secondInstall.stdout);
  await waitForPidExit(runningOverlay.pid);
  assert.equal(await fs.readFile(installedOverlayPath, 'utf-8'), '#!/bin/sh\nprintf replaced\n');
});
