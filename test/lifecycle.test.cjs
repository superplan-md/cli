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
} = require('./helpers.cjs');

test('install quiet installs bundled global assets into the configured home directory', async () => {
  const sandbox = await makeSandbox('superplan-install-quiet-');
  await fs.mkdir(path.join(sandbox.home, '.claude'), { recursive: true });
  const setupResult = await runCli(['install', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(setupResult);

  assert.equal(setupResult.code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.verified, true);
  assert.equal(payload.error, null);
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'config.toml')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'CLAUDE.md')));
});

test('init installs local artifacts and auto-runs install if global config is missing', async () => {
  const sandbox = await makeSandbox('superplan-init-auto-install-');
  
  // No global config here initially
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'config.toml')), false);

  const initResult = await runCli(['init', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'config.toml')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')));
});

test('init --yes --json creates repository scaffolding without prompting', async () => {
  const sandbox = await makeSandbox('superplan-init-json-');
  
  // Pre-install globally so we don't mix auto-install logs or logic
  await runCli(['install', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const initResult = await runCli(['init', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')));
});

test('init from a nested repo directory creates scaffolding at the repo root', async () => {
  const sandbox = await makeSandbox('superplan-init-nested-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });
  
  await runCli(['install', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const initResult = await runCli(['init', '--yes', '--json'], { cwd: nestedCwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')));
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('doctor reports valid after installation', async () => {
  const sandbox = await makeSandbox('superplan-doctor-valid-');
  
  await runCli(['install', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await runCli(['init', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const doctorResult = await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(doctorResult);

  assert.equal(payload.ok, true);
  assert.equal(payload.data.valid, true);
});
