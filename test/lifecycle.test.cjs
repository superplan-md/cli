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

test('setup quiet installs bundled global assets into the configured home directory', async () => {
  const sandbox = await makeSandbox('superplan-setup-quiet-');
  await fs.mkdir(path.join(sandbox.home, '.claude'), { recursive: true });
  const setupResult = await runCli(['setup', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(setupResult);

  assert.equal(setupResult.code, 0);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.scope, 'global');
  assert.equal(payload.data.verified, true);
  assert.equal(payload.error, null);
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'config.toml')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-release', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-guard', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-postmortem', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-handoff', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-docs', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-release', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-docs', 'SKILL.md')));

  const installedUsingSuperplanSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'superplan-entry', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedUsingSuperplanSkill, /superplan run --json/);
  assert.match(installedUsingSuperplanSkill, /superplan run <task_id> --json/);
  assert.match(installedUsingSuperplanSkill, /superplan status --json/);
  assert.match(installedUsingSuperplanSkill, /superplan task show <task_id> --json/);
  assert.match(installedUsingSuperplanSkill, /superplan task batch <change-slug> --stdin --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task next --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task why-next --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task start <task_id> --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task resume <task_id> --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task batch <change-slug> --file <path> --json/);

  const installedExecuteTaskGraphSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'superplan-execute', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedExecuteTaskGraphSkill, /superplan run --json/);
  assert.match(installedExecuteTaskGraphSkill, /superplan run <task_id> --json/);
  assert.match(installedExecuteTaskGraphSkill, /superplan task show <task_id> --json/);
  assert.doesNotMatch(installedExecuteTaskGraphSkill, /superplan task why <task_id> --json/);
  assert.doesNotMatch(installedExecuteTaskGraphSkill, /superplan task start <task_id>/);
  assert.doesNotMatch(installedExecuteTaskGraphSkill, /superplan task resume <task_id>/);

  const installedShapeSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'superplan-shape', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedShapeSkill, /superplan task batch <change-slug> --stdin --json/);
  assert.doesNotMatch(installedShapeSkill, /superplan task batch <change-slug> --file <path> --json/);
});

test('interactive setup prints the current ascii wordmark once', async () => {
  const sandbox = await makeSandbox('superplan-setup-banner-');
  const { setup } = loadDistModule('cli/commands/setup.js', {
    select: async () => 'skip',
  });

  const originalConsoleLog = console.log;
  const output = [];
  console.log = (...args) => {
    output.push(args.join(' '));
  };

  try {
    const result = await withSandboxEnv(sandbox, async () => setup({ json: false, quiet: false }));
    assert.equal(result.ok, true);
    assert.equal(result.data.scope, 'skip');
  } finally {
    console.log = originalConsoleLog;
  }

  const bannerOutput = output.join('\n');
  assert.match(bannerOutput, /____  _   _ ____  _____ ____  ____  _/);
  assert.equal((bannerOutput.match(/____  _   _ ____/g) ?? []).length, 1);
});

test('interactive setup installs only the selected agent integrations', async () => {
  const sandbox = await makeSandbox('superplan-setup-selector-');
  const confirmAnswers = [false, false];
  const checkboxAnswers = [
    ['claude'],
    ['codex'],
  ];
  const seenCheckboxChoices = [];

  await fs.mkdir(path.join(sandbox.home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(sandbox.cwd, '.codex'), { recursive: true });

  const { setup } = loadDistModule('cli/commands/setup.js', {
    select: async () => 'both',
    confirm: async () => confirmAnswers.shift() ?? false,
    checkbox: async options => {
      seenCheckboxChoices.push(options.choices.map(choice => ({
        name: choice.name,
        value: choice.value,
        checked: choice.checked,
      })));
      assert.equal(options.required, true);
      assert.equal(options.instructions.includes('! Space = select, Enter = continue'), true);
      assert.deepEqual(options.theme, {
        icon: {
          checked: '[x]',
          unchecked: '[ ]',
        },
      });
      assert.equal(options.validate([]), 'Select at least one agent integration to continue.');
      return checkboxAnswers.shift() ?? [];
    },
  });

  const result = await withSandboxEnv(sandbox, async () => setup({ json: false, quiet: false }));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'both');
  assert.equal(confirmAnswers.length, 0);
  assert.deepEqual(result.data.agents.map(agent => agent.name).sort(), ['claude', 'codex']);
  assert.deepEqual(seenCheckboxChoices[0], [
    { name: 'Claude Code', value: 'claude', checked: false },
  ]);
  assert.match(seenCheckboxChoices[0].map(choice => choice.name).join(', '), /Claude Code/);
  assert.deepEqual(seenCheckboxChoices[1], [
    { name: 'Codex', value: 'codex', checked: false },
  ]);
  assert.equal(seenCheckboxChoices.length, 2);
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.equal(await pathExists(path.join(sandbox.home, '.gemini', 'commands', 'superplan.toml')), false);
  assert.ok(await pathExists(path.join(sandbox.cwd, '.codex', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.equal(await pathExists(path.join(sandbox.cwd, '.gemini', 'commands', 'superplan.toml')), false);
});

test('interactive local setup from a nested repo directory installs into the repo root workspace', async () => {
  const sandbox = await makeSandbox('superplan-setup-nested-root-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');
  const expectedWorkspaceRoot = await fs.realpath(sandbox.cwd);
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;
  const confirmAnswers = [false];

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(path.join(sandbox.cwd, '.codex'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });

  const { setup } = loadDistModule('cli/commands/setup.js', {
    select: async () => 'local',
    confirm: async () => confirmAnswers.shift() ?? false,
    checkbox: async () => ['codex'],
  });

  process.chdir(nestedCwd);
  process.env.HOME = sandbox.home;

  try {
    const result = await setup({ json: false, quiet: false });

    assert.equal(result.ok, true);
    assert.equal(result.data.scope, 'local');
    assert.equal(result.data.config_path, path.join(expectedWorkspaceRoot, '.superplan', 'config.toml'));
    assert.deepEqual(result.data.agents.map(agent => agent.name), ['codex']);
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }

  assert.equal(confirmAnswers.length, 0);
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'config.toml')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.codex', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('interactive setup select-all option installs every supported machine-level agent integration', async () => {
  const sandbox = await makeSandbox('superplan-setup-select-all-');
  const confirmAnswers = [false];

  await fs.mkdir(path.join(sandbox.home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(sandbox.home, '.gemini'), { recursive: true });
  await fs.mkdir(path.join(sandbox.home, '.cursor'), { recursive: true });
  await fs.mkdir(path.join(sandbox.home, '.codex'), { recursive: true });
  await fs.mkdir(path.join(sandbox.home, '.config', 'opencode'), { recursive: true });

  const { setup } = loadDistModule('cli/commands/setup.js', {
    select: async () => 'global',
    confirm: async () => confirmAnswers.shift() ?? false,
    checkbox: async options => {
      assert.equal(options.message, 'Select machine-level AI agents');
      assert.equal(
        options.instructions,
        '\n! Found: Claude Code, Codex, Gemini, Cursor, OpenCode\n! Space = select, Enter = continue',
      );
      assert.deepEqual(options.theme, {
        icon: {
          checked: '[x]',
          unchecked: '[ ]',
        },
      });
      assert.deepEqual(options.choices.map(choice => choice.name), [
        'Claude Code',
        'Codex',
        'Gemini',
        'Cursor',
        'OpenCode',
        'Select all found AI agents',
      ]);
      return ['__all_agents__'];
    },
  });

  const result = await withSandboxEnv(sandbox, async () => setup({ json: false, quiet: false }));

  assert.equal(result.ok, true);
  assert.equal(result.data.scope, 'global');
  assert.equal(confirmAnswers.length, 0);
  assert.deepEqual(result.data.agents.map(agent => agent.name).sort(), [
    'claude',
    'codex',
    'cursor',
    'gemini',
    'opencode',
  ]);
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.gemini', 'commands', 'superplan.toml')));
  assert.ok(await pathExists(path.join(sandbox.home, '.cursor', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.codex', 'skills', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'opencode', 'skills', 'superplan-entry', 'SKILL.md')));
});

test('doctor reports valid after quiet global setup in a clean repo', async () => {
  const sandbox = await makeSandbox('superplan-doctor-valid-');
  const fakeClaudeDir = path.join(sandbox.home, '.claude');
  await runCli(['setup', '--quiet', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });

  const doctorResult = await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(doctorResult);

  assert.equal(payload.ok, true);
  assert.equal(payload.data.valid, true);
  assert.deepEqual(payload.data.issues, []);
  assert.equal(payload.error, null);
  assert.equal(await pathExists(fakeClaudeDir), false);
});

test('doctor reports missing home agent installs when a supported global agent directory exists', async () => {
  const sandbox = await makeSandbox('superplan-doctor-home-agent-');

  await fs.mkdir(path.join(sandbox.home, '.claude'), { recursive: true });
  await fs.mkdir(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry'), { recursive: true });
  await fs.writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n', 'utf-8');
  await fs.writeFile(
    path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry', 'SKILL.md'),
    '# superplan-entry\n',
    'utf-8',
  );

  const doctorResult = await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(doctorResult);
  const issueCodes = payload.data.issues.map(issue => issue.code);

  assert.equal(payload.ok, true);
  assert.equal(payload.data.valid, false);
  assert(issueCodes.includes('AGENT_SKILLS_MISSING'));
  assert.equal(payload.error, null);
});

test('init quiet requires global setup before repo initialization', async () => {
  const sandbox = await makeSandbox('superplan-init-required-');
  const result = await runCli(['init', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: 'SETUP_REQUIRED',
      message: 'Global setup is required before init',
      retryable: true,
    },
  });
});

test('init json requires global setup before repo initialization without prompting', async () => {
  const sandbox = await makeSandbox('superplan-init-json-required-');
  const result = await runCli(['init', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: 'SETUP_REQUIRED',
      message: 'Global setup is required before init',
      retryable: true,
    },
  });
});

test('init quiet creates repository scaffolding after setup is complete', async () => {
  const sandbox = await makeSandbox('superplan-init-quiet-');

  await runCli(['setup', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const initResult = await runCli(['init', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      root: '.superplan',
    },
    error: null,
  });
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'config.toml')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'runtime')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes')));
});

test('init json creates repository scaffolding after setup is complete without prompting', async () => {
  const sandbox = await makeSandbox('superplan-init-json-');

  await runCli(['setup', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const initResult = await runCli(['init', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const payload = parseCliJson(initResult);

  assert.equal(initResult.code, 0);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      root: '.superplan',
    },
    error: null,
  });
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'config.toml')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'runtime')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes')));
});

test('init quiet from a nested repo directory creates scaffolding at the repo root', async () => {
  const sandbox = await makeSandbox('superplan-init-nested-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });

  await runCli(['setup', '--quiet', '--json'], { cwd: nestedCwd, env: sandbox.env });
  const initResult = await runCli(['init', '--quiet', '--json'], { cwd: nestedCwd, env: sandbox.env });
  const payload = parseCliJson(initResult);
  const relativeRoot = path.relative(nestedCwd, path.join(sandbox.cwd, '.superplan')) || '.superplan';

  assert.equal(initResult.code, 0);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      root: relativeRoot,
    },
    error: null,
  });
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'config.toml')));
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});
