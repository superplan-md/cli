const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  loadDistModule,
  makeSandbox,
  pathExists,
  withSandboxEnv,
  writeFile,
} = require('./helpers.cjs');

test('remove deletes local superplan state including .superplan changes', async () => {
  const sandbox = await makeSandbox('superplan-remove-local-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'using-superplan', 'SKILL.md'), '# using-superplan\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'execute-task-graph', 'SKILL.md'), '# execute-task-graph\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'custom-skill', 'SKILL.md'), '# custom\n');

  const { remove } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'local',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => remove({}));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'local');
  assert.equal(result.data.mode, 'remove');
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'using-superplan')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'execute-task-graph')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'custom-skill', 'SKILL.md')), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes')), false);
});

test('purge deletes local superplan state and .superplan changes directory', async () => {
  const sandbox = await makeSandbox('superplan-purge-local-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');

  const { purge } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'local',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => purge({}));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'local');
  assert.equal(result.data.mode, 'purge');
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes')), false);
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

  const result = await withSandboxEnv(sandbox, async () => remove({}));

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

  const result = await withSandboxEnv(sandbox, async () => remove({}));

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

  await writeFile(path.join(sandbox.cwd, '.superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'using-superplan', 'SKILL.md'), '# using-superplan\n');
  await writeFile(path.join(sandbox.cwd, '.claude', 'skills', 'execute-task-graph', 'SKILL.md'), '# execute-task-graph\n');
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
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'using-superplan')), false);
});
