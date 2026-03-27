const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
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

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.on('close', code => {
      resolve({ code, stdout, stderr });
    });
  });
}

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

test('install quiet honors a global Claude preference from root CLAUDE.md and creates the skills namespace', async () => {
  const sandbox = await makeSandbox('superplan-install-claude-root-');
  await fs.writeFile(path.join(sandbox.home, 'CLAUDE.md'), '# personal claude prefs\n');

  const setupResult = await runCli(['install', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(setupResult);

  assert.equal(setupResult.code, 0);
  assert.equal(payload.ok, true);
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'CLAUDE.md')));
  assert.equal(await pathExists(path.join(sandbox.home, '.claude', 'hooks.json')), false);

  const globalSettings = JSON.parse(await fs.readFile(path.join(sandbox.home, '.claude', 'settings.json'), 'utf-8'));
  assert.equal(globalSettings.hooks.SessionStart[0].hooks[0].command, './run-hook.cmd session-start');

  const hookRun = await runCommand('bash', ['./run-hook.cmd', 'session-start'], {
    cwd: path.join(sandbox.home, '.claude'),
    env: {
      ...sandbox.env,
      CLAUDE_PLUGIN_ROOT: '1',
    },
  });
  assert.equal(hookRun.code, 0, hookRun.stderr || hookRun.stdout);
  const hookPayload = JSON.parse(hookRun.stdout);
  assert.match(hookPayload.hookSpecificOutput.additionalContext, /superplan-entry/);
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
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')), false);
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
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')), false);
});

test('init --yes --json honors a repo Claude preference from root CLAUDE.md and creates local Claude skills', async () => {
  const sandbox = await makeSandbox('superplan-init-claude-root-');

  await runCli(['install', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await fs.writeFile(path.join(sandbox.cwd, 'CLAUDE.md'), '# repo claude prefs\n');
  await fs.mkdir(path.join(sandbox.cwd, '.claude'), { recursive: true });
  await fs.writeFile(
    path.join(sandbox.cwd, '.claude', 'settings.local.json'),
    `${JSON.stringify({
      permissions: {
        allow: ['Bash(superplan init:*)'],
      },
      hooks: {
        sessionStart: [
          {
            command: './session-start',
          },
        ],
      },
    }, null, 2)}\n`,
  );

  const initResult = await runCli(['init', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);
  assert.ok(await pathExists(path.join(sandbox.cwd, '.claude', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.claude', 'CLAUDE.md')));
  assert.equal(await pathExists(path.join(sandbox.cwd, '.claude', 'hooks.json')), false);

  const localSettings = JSON.parse(await fs.readFile(path.join(sandbox.cwd, '.claude', 'settings.local.json'), 'utf-8'));
  assert.deepEqual(localSettings.permissions, {
    allow: ['Bash(superplan init:*)'],
  });
  assert.equal(localSettings.hooks.SessionStart[0].hooks[0].command, './run-hook.cmd session-start');
  assert.equal(localSettings.hooks.sessionStart, undefined);

  const localHookRun = await runCommand('bash', ['./run-hook.cmd', 'session-start'], {
    cwd: path.join(sandbox.cwd, '.claude'),
    env: {
      ...sandbox.env,
      CLAUDE_PLUGIN_ROOT: '1',
    },
  });
  assert.equal(localHookRun.code, 0, localHookRun.stderr || localHookRun.stdout);
  const localHookPayload = JSON.parse(localHookRun.stdout);
  assert.match(localHookPayload.hookSpecificOutput.additionalContext, /superplan-entry/);
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
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')), false);
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
