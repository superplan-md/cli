const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  loadDistModule,
  makeSandbox,
  parseCliJson,
  pathExists,
  runCli,
  withSandboxEnv,
  writeFile,
  getSuperplanRoot,
} = require('./helpers.cjs');

function getLocalSuperplanRoot(sandbox) {
  return path.join(sandbox.cwd, '.superplan');
}

test('remove deletes local superplan state including .superplan changes', async () => {
  const sandbox = await makeSandbox('superplan-remove-local-');
  const localSuperplanRoot = getLocalSuperplanRoot(sandbox);

  await writeFile(path.join(localSuperplanRoot, 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(localSuperplanRoot, 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-entry', 'SKILL.md'), '# superplan-entry\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-execute', 'SKILL.md'), '# superplan-execute\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'custom-skill', 'SKILL.md'), '# custom\n');

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'local',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'local');
  assert.equal(result.data.mode, 'remove');
  assert.equal(await pathExists(localSuperplanRoot), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-entry')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-execute')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'custom-skill', 'SKILL.md')), true);
  assert.equal(await pathExists(path.join(localSuperplanRoot, 'changes')), false);
});

test('remove also cleans up legacy pre-prefix skill directories', async () => {
  const sandbox = await makeSandbox('superplan-remove-legacy-skill-names-');
  const localSuperplanRoot = getLocalSuperplanRoot(sandbox);

  await writeFile(path.join(localSuperplanRoot, 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'using-superplan', 'SKILL.md'), '# using-superplan\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'execute-task-graph', 'SKILL.md'), '# execute-task-graph\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'custom-skill', 'SKILL.md'), '# custom\n');

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'local',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}));

  assert.equal(result.ok, true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'using-superplan')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'execute-task-graph')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'custom-skill', 'SKILL.md')), true);
});

test('remove deletes local superplan state even when only .superplan exists', async () => {
  const sandbox = await makeSandbox('superplan-remove-only-runtime-');
  const localSuperplanRoot = getLocalSuperplanRoot(sandbox);

  await writeFile(path.join(localSuperplanRoot, 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(localSuperplanRoot, 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'local',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'local');
  assert.equal(result.data.mode, 'remove');
  assert.equal(await pathExists(localSuperplanRoot), false);
  assert.equal(await pathExists(path.join(localSuperplanRoot, 'changes')), false);
});

test('remove deletes the recorded global overlay install when removing machine-level state', async () => {
  const sandbox = await makeSandbox('superplan-remove-global-overlay-');
  const overlayInstallPath = path.join(sandbox.home, '.local', 'share', 'superplan', 'overlay', 'overlay-bin');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'install.json'), JSON.stringify({
    install_method: 'remote_repo',
    repo_url: 'https://github.com/example/superplan.git',
    ref: 'dev',
    overlay: {
      install_method: 'copied_prebuilt',
      install_path: overlayInstallPath,
      executable_path: overlayInstallPath,
    },
  }, null, 2));
  await writeFile(overlayInstallPath, '#!/bin/sh\nexit 0\n');
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n');

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'global',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}, {
    readInstallMetadata: async () => ({
      install_method: 'remote_repo',
      repo_url: 'https://github.com/example/superplan.git',
      ref: 'dev',
      overlay: {
        install_method: 'copied_prebuilt',
        install_path: overlayInstallPath,
        executable_path: overlayInstallPath,
      },
    }),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'global');
  assert.equal(await pathExists(overlayInstallPath), false);
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan')), false);
});

test('remove deletes the recorded global CLI install when removing machine-level state', async () => {
  const sandbox = await makeSandbox('superplan-remove-global-cli-');
  const installPrefix = path.join(sandbox.home, '.local');
  const installBinDir = path.join(installPrefix, 'bin');
  const installedPackageDir = path.join(installPrefix, 'lib', 'node_modules', 'superplan');
  const installedBinPath = path.join(installBinDir, 'superplan');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'install.json'), JSON.stringify({
    install_method: 'remote_repo',
    repo_url: 'https://github.com/example/superplan.git',
    ref: 'dev',
    install_prefix: installPrefix,
    install_bin: installBinDir,
  }, null, 2));
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(installedPackageDir, 'dist', 'cli', 'main.js'), '#!/usr/bin/env node\n');
  await writeFile(installedBinPath, '#!/bin/sh\nexit 0\n');

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'global',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}, {
    readInstallMetadata: async () => ({
      install_method: 'remote_repo',
      repo_url: 'https://github.com/example/superplan.git',
      ref: 'dev',
      install_prefix: installPrefix,
      install_bin: installBinDir,
    }),
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'global');
  assert.equal(await pathExists(installedPackageDir), false);
  assert.equal(await pathExists(installedBinPath), false);
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan')), false);
});

test('remove infers and deletes the running global CLI install when metadata is missing', async () => {
  const sandbox = await makeSandbox('superplan-remove-infer-cli-');
  const installPrefix = path.join(sandbox.home, '.pnpm-global');
  const installBinDir = path.join(installPrefix, 'bin');
  const installedPackageDir = path.join(installPrefix, 'lib', 'node_modules', 'superplan');
  const installedBinPath = path.join(installBinDir, 'superplan');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(installedPackageDir, 'dist', 'cli', 'main.js'), '#!/usr/bin/env node\n');
  await writeFile(installedBinPath, '#!/bin/sh\nexit 0\n');

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'global',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}, {
    readInstallMetadata: async () => null,
    currentPackageRoot: installedPackageDir,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'global');
  assert.equal(await pathExists(installedPackageDir), false);
  assert.equal(await pathExists(installedBinPath), false);
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan')), false);
});

test('remove deletes a symlinked dev-style global install by inferring from the invoked superplan bin path', async () => {
  const sandbox = await makeSandbox('superplan-remove-symlinked-cli-');
  const workspaceRoot = path.join(sandbox.root, 'source', 'superplan-cli');
  const installPrefix = path.join(sandbox.home, '.homebrew');
  const installBinDir = path.join(installPrefix, 'bin');
  const installedPackageDir = path.join(installPrefix, 'lib', 'node_modules', 'superplan');
  const installedBinPath = path.join(installBinDir, 'superplan');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(workspaceRoot, 'dist', 'cli', 'main.js'), '#!/usr/bin/env node\n');
  await fs.mkdir(path.dirname(installedPackageDir), { recursive: true });
  await fs.mkdir(installBinDir, { recursive: true });
  await fs.symlink(workspaceRoot, installedPackageDir);
  await fs.symlink(path.join(installedPackageDir, 'dist', 'cli', 'main.js'), installedBinPath);

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'global',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}, {
    readInstallMetadata: async () => null,
    currentPackageRoot: workspaceRoot,
    invokedEntryPath: installedBinPath,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'global');
  assert.equal(await pathExists(installedPackageDir), false);
  assert.equal(await pathExists(installedBinPath), false);
  assert.equal(await pathExists(workspaceRoot), true);
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan')), false);
});

test('remove from a nested subdirectory deletes the nearest parent local superplan root', async () => {
  const sandbox = await makeSandbox('superplan-remove-parent-root-');
  const nestedWorkspaceDir = path.join(sandbox.cwd, 'apps', 'overlay-desktop');
  const localSuperplanRoot = getLocalSuperplanRoot(sandbox);

  await writeFile(path.join(localSuperplanRoot, 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(localSuperplanRoot, 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-entry', 'SKILL.md'), '# superplan-entry\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-execute', 'SKILL.md'), '# superplan-execute\n');
  await fs.mkdir(nestedWorkspaceDir, { recursive: true });

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'local',
    confirm: async () => true,
  });

  const result = await withSandboxEnv({
    ...sandbox,
    cwd: nestedWorkspaceDir,
  }, async () => remove({}));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'local');
  assert.equal(await pathExists(localSuperplanRoot), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-entry')), false);
});

test('remove supports explicit non-interactive local cleanup for agents', async () => {
  const sandbox = await makeSandbox('superplan-remove-cli-local-');
  const localSuperplanRoot = getLocalSuperplanRoot(sandbox);

  await writeFile(path.join(localSuperplanRoot, 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(localSuperplanRoot, 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-entry', 'SKILL.md'), '# superplan-entry\n');

  const result = await runCli(['remove', '--scope', 'local', '--yes', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.scope, 'local');
  assert.equal(payload.data.mode, 'remove');
  assert.equal(Array.isArray(payload.data.removed_paths), true);
  assert.equal(Array.isArray(payload.data.agents), true);
  assert.equal(payload.data.next_action.type, 'stop');
  assert.equal(payload.error, null);
  assert.equal(await pathExists(localSuperplanRoot), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-entry')), false);
});

test('remove rejects non-interactive agent mode without explicit scope and confirmation', async () => {
  const sandbox = await makeSandbox('superplan-remove-cli-invalid-');
  const result = await runCli(['remove', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_REMOVE_COMMAND');
  assert.match(payload.error.message, /Remove requires --scope in non-interactive mode/);
  assert.match(payload.error.message, /superplan remove --scope <local\|global\|skip> --yes --json/);
  assert.equal(payload.error.next_action.type, 'stop');
});
