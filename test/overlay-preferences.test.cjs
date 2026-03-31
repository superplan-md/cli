const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  loadDistModule,
  makeSandbox,
  withSandboxEnv,
  writeFile,
  getSuperplanRoot,
} = require('./helpers.cjs');

async function writeGlobalOverlayConfig(sandbox, enabled) {
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), `version = "0.1"

[overlay]
enabled = ${enabled ? 'true' : 'false'}
`);
}

test('readOverlayPreferences falls back to the global setting when the local .superplan folder is missing', async () => {
  const sandbox = await makeSandbox('superplan-overlay-prefs-no-local-root-');
  const { readOverlayPreferences } = loadDistModule('cli/overlay-preferences.js');

  await writeGlobalOverlayConfig(sandbox, true);

  const preferences = await withSandboxEnv(sandbox, async () => readOverlayPreferences());

  assert.equal(preferences.global_enabled, true);
  assert.equal(preferences.local_enabled, null);
  assert.equal(preferences.effective_enabled, true);
  assert.equal(preferences.effective_scope, 'global');
});

test('readOverlayPreferences falls back to the global setting when local .superplan exists without config.toml', async () => {
  const sandbox = await makeSandbox('superplan-overlay-prefs-no-local-config-');
  const { readOverlayPreferences } = loadDistModule('cli/overlay-preferences.js');

  await writeGlobalOverlayConfig(sandbox, true);
  await fs.mkdir(getSuperplanRoot(sandbox), { recursive: true });

  const preferences = await withSandboxEnv(sandbox, async () => readOverlayPreferences());

  assert.equal(preferences.global_enabled, true);
  assert.equal(preferences.local_enabled, null);
  assert.equal(preferences.effective_enabled, true);
  assert.equal(preferences.effective_scope, 'global');
});

test('readOverlayPreferences ignores a partial local overlay section and keeps the global setting', async () => {
  const sandbox = await makeSandbox('superplan-overlay-prefs-partial-');
  const { readOverlayPreferences } = loadDistModule('cli/overlay-preferences.js');

  await writeGlobalOverlayConfig(sandbox, true);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'config.toml'), `version = "0.1"

[overlay]

[notifications]
sound = true
`);

  const preferences = await withSandboxEnv(sandbox, async () => readOverlayPreferences());

  assert.equal(preferences.global_enabled, true);
  assert.equal(preferences.local_enabled, null);
  assert.equal(preferences.effective_enabled, true);
  assert.equal(preferences.effective_scope, 'global');
});

test('readOverlayPreferences ignores an invalid local overlay value and keeps the global setting', async () => {
  const sandbox = await makeSandbox('superplan-overlay-prefs-invalid-');
  const { readOverlayPreferences } = loadDistModule('cli/overlay-preferences.js');

  await writeGlobalOverlayConfig(sandbox, true);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'config.toml'), `version = "0.1"

[overlay]
enabled = maybe
`);

  const preferences = await withSandboxEnv(sandbox, async () => readOverlayPreferences());

  assert.equal(preferences.global_enabled, true);
  assert.equal(preferences.local_enabled, null);
  assert.equal(preferences.effective_enabled, true);
  assert.equal(preferences.effective_scope, 'global');
});

test('readOverlayPreferences prefers an explicit local overlay setting over the global one', async () => {
  const sandbox = await makeSandbox('superplan-overlay-prefs-local-override-');
  const { readOverlayPreferences } = loadDistModule('cli/overlay-preferences.js');

  await writeGlobalOverlayConfig(sandbox, true);
  await writeFile(path.join(sandbox.cwd, '.superplan', 'config.toml'), `version = "0.1"

[overlay]
enabled = false
`);

  const preferences = await withSandboxEnv(sandbox, async () => readOverlayPreferences());

  assert.equal(preferences.global_enabled, true);
  assert.equal(preferences.local_enabled, false);
  assert.equal(preferences.effective_enabled, false);
  assert.equal(preferences.effective_scope, 'local');
});
