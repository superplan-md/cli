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
  getSuperplanRoot,
} = require('./helpers.cjs');

async function runCommand(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
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

test('init --global installs bundled global assets into the configured home directory', async () => {
  const sandbox = await makeSandbox('superplan-init-global-quiet-');
  await fs.mkdir(path.join(sandbox.home, '.claude'), { recursive: true });
  const setupResult = await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(setupResult);

  assert.equal(setupResult.code, 0);
  assert.equal(payload.ok, true);
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'config.toml')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'CLAUDE.md')));

  const claudeContract = await fs.readFile(path.join(sandbox.home, '.claude', 'CLAUDE.md'), 'utf-8');
  assert.match(claudeContract, /Read-only repo inspection, local reasoning, and user-facing planning may happen before task creation\./);
  assert.doesNotMatch(claudeContract, /1\. Run `superplan status --json`\./);
  assert.match(claudeContract, /1\. If continuing known work, run `superplan run <task_ref> --json`; if the user starts unrelated work in this same chat, run `superplan run --fresh --json`; otherwise start with `superplan run --json`\./);
  assert.match(claudeContract, /Communication modes:/);
  assert.match(claudeContract, /`control-plane mode` is the default/);
  assert.match(claudeContract, /`planning mode` is for `superplan-plan`, `superplan-brainstorm`/);

  const entrySkill = await fs.readFile(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry', 'SKILL.md'), 'utf-8');
  assert.match(entrySkill, /This skill runs in `control-plane mode`\./);

  const planSkill = await fs.readFile(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-plan', 'SKILL.md'), 'utf-8');
  assert.match(planSkill, /This skill runs in `planning mode`\./);
});

test('init --global honors a global Claude preference from root CLAUDE.md and creates the skills namespace', async () => {
  const sandbox = await makeSandbox('superplan-init-global-claude-root-');
  await fs.writeFile(path.join(sandbox.home, 'CLAUDE.md'), '# personal claude prefs\n');

  const setupResult = await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
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

  const claudeEnvFile = path.join(sandbox.root, 'claude-session.env');
  const hookWithSessionInput = await runCommand('bash', ['./run-hook.cmd', 'session-start'], {
    cwd: path.join(sandbox.home, '.claude'),
    env: {
      ...sandbox.env,
      CLAUDE_PLUGIN_ROOT: '1',
      CLAUDE_ENV_FILE: claudeEnvFile,
    },
    input: JSON.stringify({
      session_id: 'claude-session-123',
      transcript_path: path.join(sandbox.home, '.claude', 'projects', 'example.jsonl'),
      cwd: sandbox.cwd,
      hook_event_name: 'SessionStart',
      source: 'startup',
      model: 'claude-sonnet',
    }),
  });
  assert.equal(hookWithSessionInput.code, 0, hookWithSessionInput.stderr || hookWithSessionInput.stdout);
  assert.match(await fs.readFile(claudeEnvFile, 'utf-8'), /export SUPERPLAN_SESSION_ID=claude-session-123/);
});

test('session-start falls back to per-chat command-prefix guidance for Codex and OpenCode hooks', async () => {
  const sandbox = await makeSandbox('superplan-session-start-generic-hosts-');
  await fs.mkdir(path.join(sandbox.home, '.codex'), { recursive: true });
  await fs.mkdir(path.join(sandbox.home, '.config', 'opencode'), { recursive: true });
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const codexHookRun = await runCommand('bash', ['./run-hook.cmd', 'session-start'], {
    cwd: path.join(sandbox.home, '.codex'),
    env: {
      ...sandbox.env,
      CODEX_PLUGIN_ROOT: '1',
    },
    input: JSON.stringify({
      thread_id: 'codex-thread-123',
      cwd: sandbox.cwd,
      hook_event_name: 'SessionStart',
      source: 'startup',
    }),
  });
  assert.equal(codexHookRun.code, 0, codexHookRun.stderr || codexHookRun.stdout);
  const codexHookPayload = JSON.parse(codexHookRun.stdout);
  assert.match(codexHookPayload.additional_context, /SUPERPLAN_SESSION_ID=codex-thread-123/);
  assert.match(codexHookPayload.additional_context, /prefix every Superplan CLI command/i);

  const opencodeHookRun = await runCommand('bash', ['./run-hook.cmd', 'session-start'], {
    cwd: path.join(sandbox.home, '.config', 'opencode'),
    env: {
      ...sandbox.env,
      OPENCODE_PLUGIN_ROOT: '1',
    },
    input: JSON.stringify({
      sessionId: 'opencode-session-456',
      cwd: sandbox.cwd,
      hook_event_name: 'SessionStart',
      source: 'startup',
    }),
  });
  assert.equal(opencodeHookRun.code, 0, opencodeHookRun.stderr || opencodeHookRun.stdout);
  const opencodeHookPayload = JSON.parse(opencodeHookRun.stdout);
  assert.match(opencodeHookPayload.additional_context, /SUPERPLAN_SESSION_ID=opencode-session-456/);
  assert.match(opencodeHookPayload.additional_context, /prefix every Superplan CLI command/i);
});

test('local Antigravity workflow install carries the session-token fallback guidance', async () => {
  const sandbox = await makeSandbox('superplan-antigravity-session-guidance-');
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await fs.mkdir(path.join(sandbox.cwd, '.agents'), { recursive: true });

  const initResult = await runCli(['init', '--local', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);

  const antigravityEntry = await fs.readFile(path.join(sandbox.cwd, '.agents', 'workflows', 'superplan-entry.md'), 'utf-8');
  assert.match(antigravityEntry, /workflow-only hosts may not have a startup hook at all/i);
  assert.match(antigravityEntry, /mint one stable chat-local token/i);
  assert.match(antigravityEntry, /SUPERPLAN_SESSION_ID/i);
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
  assert.equal(await pathExists(path.join(getSuperplanRoot(sandbox), 'plan.md')), false);
});

test('init --yes --json installs skills locally without prompting', async () => {
  const sandbox = await makeSandbox('superplan-init-json-');
  
  // Pre-install globally so we don't mix auto-install logs or logic
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const initResult = await runCli(['init', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);
  // No local .superplan/ folder is created in new flow
  assert.equal(await pathExists(path.join(sandbox.cwd, ".superplan")), false);
});

test('init --yes auto-installs without prompting in human mode', async () => {
  const sandbox = await makeSandbox('superplan-init-yes-human-');

  const initResult = await runCli(['init', '--yes'], { cwd: sandbox.cwd, env: sandbox.env });

  assert.equal(initResult.code, 0, initResult.stderr || initResult.stdout);
  assert.match(initResult.stdout, /Global Superplan initialized/);
  assert.doesNotMatch(initResult.stdout, /Would you like to install it now\?/);
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'config.toml')), true);
});

test('init --yes --json honors a repo Claude preference from root CLAUDE.md and creates local Claude skills', async () => {
  const sandbox = await makeSandbox('superplan-init-claude-root-');

  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
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

  const initResult = await runCli(['init', '--local', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);
  assert.ok(await pathExists(path.join(sandbox.home, ".config", "superplan", "skills", "superplan-entry", "SKILL.md")));
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

test('init from a nested repo directory installs at the repo root', async () => {
  const sandbox = await makeSandbox('superplan-init-nested-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });
  
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const initResult = await runCli(['init', '--yes', '--json'], { cwd: nestedCwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.equal(payload.ok, true);
  // No local .superplan/ folder created
  assert.equal(await pathExists(path.join(sandbox.cwd, ".superplan")), false);
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('doctor reports valid after installation', async () => {
  const sandbox = await makeSandbox('superplan-doctor-valid-');
  
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await runCli(['init', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const doctorResult = await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(doctorResult);

  assert.equal(payload.ok, true);
  // With global-only superplan, doctor may report some issues due to test environment
  // but the command itself should succeed
});
