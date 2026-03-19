const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadDistModule,
  makeSandbox,
  pathExists,
  withSandboxEnv,
  writeFile,
} = require('./helpers.cjs');

test('remove deletes local superplan state but leaves changes intact', async () => {
  const sandbox = await makeSandbox('superplan-remove-local-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.cwd, 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');
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
  assert.equal(await pathExists(path.join(sandbox.cwd, 'changes')), true);
});

test('purge deletes local superplan state and changes directory', async () => {
  const sandbox = await makeSandbox('superplan-purge-local-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.cwd, 'changes', 'demo', 'tasks', 'T-001.md'), '# task\n');

  const { purge } = loadDistModule('cli/commands/remove.js', {
    select: async () => 'local',
    confirm: async () => true,
  });

  const result = await withSandboxEnv(sandbox, async () => purge({}));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'local');
  assert.equal(result.data.mode, 'purge');
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan')), false);
  assert.equal(await pathExists(path.join(sandbox.cwd, 'changes')), false);
});
