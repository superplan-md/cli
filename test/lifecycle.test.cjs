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
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-shape', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-release', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'superplan-docs', 'SKILL.md')));

  const installedUsingSuperplanSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'superplan-entry', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedUsingSuperplanSkill, /superplan run --json/);
  assert.match(installedUsingSuperplanSkill, /superplan run <task_id> --json/);
  assert.match(installedUsingSuperplanSkill, /superplan status --json/);
  assert.match(installedUsingSuperplanSkill, /superplan context bootstrap --json/);
  assert.match(installedUsingSuperplanSkill, /superplan task show <task_id> --json/);
  assert.match(installedUsingSuperplanSkill, /superplan task batch <change-slug> --stdin --json/);
  assert.match(installedUsingSuperplanSkill, /manual creation of individual `tasks\/T-xxx\.md` files is off limits/i);
  assert.match(installedUsingSuperplanSkill, /do not use shell loops or direct file-edit rewrites such as `for`, `sed`, `cat > \.\.\.`, `printf > \.\.\.`, or here-docs/i);
  assert.match(installedUsingSuperplanSkill, /author the root `\.superplan\/changes\/<change-slug>\/tasks\.md` manually as graph truth/i);
  assert.match(installedUsingSuperplanSkill, /large, ambiguous, or multi-workstream, do not jump straight from the raw request into task scaffolding/i);
  assert.match(installedUsingSuperplanSkill, /stdin transport into `superplan task batch --stdin --json`/i);
  assert.match(installedUsingSuperplanSkill, /Entry routing is not permission to explore the CLI surface\./);
  assert.match(installedUsingSuperplanSkill, /do not call `--help`, neighboring subcommands, or diagnostic commands/i);
  assert.match(installedUsingSuperplanSkill, /launchable companion is installed/i);
  assert.match(installedUsingSuperplanSkill, /surface `overlay\.companion\.reason` instead of assuming the overlay appeared/i);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task next --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task why-next --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task start <task_id> --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task resume <task_id> --json/);
  assert.doesNotMatch(installedUsingSuperplanSkill, /superplan task batch <change-slug> --file <path> --json/);

  const installedShapeSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'superplan-shape', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedShapeSkill, /superplan task new <change-slug>/);
  assert.match(installedShapeSkill, /superplan task batch <change-slug> --stdin --json/);
  assert.match(installedShapeSkill, /tasks\.md/);
  assert.match(installedShapeSkill, /Manual creation of individual `tasks\/T-xxx\.md` files is off limits\./);
  assert.match(installedShapeSkill, /Authoring the root `tasks\.md` manually is expected\./);
  assert.match(installedShapeSkill, /Do not use shell loops or direct file-edit rewrites such as `for`, `sed`, `cat > \.\.\.`, `printf > \.\.\.`, or here-docs/i);
  assert.match(installedShapeSkill, /superplan validate <change-slug> --json/);
  assert.match(installedShapeSkill, /dense, ambiguous requirement dump into task scaffolding/i);
  assert.match(installedShapeSkill, /stdin transport into `superplan task batch --stdin --json`/i);
  assert.match(installedShapeSkill, /use one `superplan task batch <change-slug> --stdin --json` call over repeated `superplan task new` calls\./);
  assert.match(installedShapeSkill, /Shaping is not permission to explore the CLI surface\./);
  assert.match(installedShapeSkill, /use the current CLI contract already listed in this skill instead of probing adjacent commands/i);
  assert.doesNotMatch(installedShapeSkill, /superplan task batch <change-slug> --file <path> --json/);

  const installedExecuteTaskGraphSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'superplan-execute', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedExecuteTaskGraphSkill, /superplan run --json/);
  assert.match(installedExecuteTaskGraphSkill, /superplan run <task_id> --json/);
  assert.match(installedExecuteTaskGraphSkill, /superplan task show <task_id> --json/);
  assert.match(installedExecuteTaskGraphSkill, /Execution is not permission to wander across CLI commands\./);
  assert.match(installedExecuteTaskGraphSkill, /launchable companion is installed/i);
  assert.match(installedExecuteTaskGraphSkill, /surface `overlay\.companion\.reason` instead of assuming the overlay appeared/i);
  assert.match(installedExecuteTaskGraphSkill, /repeatedly polling `status` or `task show` without a concrete state, blocker, or handoff reason/i);
  assert.doesNotMatch(installedExecuteTaskGraphSkill, /superplan task why <task_id> --json/);
  assert.doesNotMatch(installedExecuteTaskGraphSkill, /superplan task start <task_id>/);
  assert.doesNotMatch(installedExecuteTaskGraphSkill, /superplan task resume <task_id>/);

  const installedRouteSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'superplan-route', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedRouteSkill, /Routing is not permission to explore the CLI surface\./);
  assert.match(installedRouteSkill, /CLI-scaffolded `tasks\/T-\*\.md`/);
  assert.match(installedRouteSkill, /dense requirement dump, JTBD list, or multi-constraint brief/i);
  assert.match(installedRouteSkill, /under-shaping large ambiguous work just to preserve the appearance of low ceremony/i);
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
  assert.equal(seenCheckboxChoices.length, 2);
  assert.equal(seenCheckboxChoices[0].some(choice => choice.value === 'claude'), true);
  assert.equal(seenCheckboxChoices[0].some(choice => choice.value === '__all_agents__'), true);
  assert.equal(seenCheckboxChoices[0].every(choice => choice.checked === false), true);
  assert.match(seenCheckboxChoices[0].map(choice => choice.name).join(', '), /Claude Code/);
  assert.equal(seenCheckboxChoices[1].some(choice => choice.value === 'codex'), true);
  assert.equal(seenCheckboxChoices[1].some(choice => choice.value === '__all_agents__'), true);
  assert.equal(seenCheckboxChoices[1].every(choice => choice.checked === false), true);
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
        '\n! Found: Claude Code, Codex, Gemini, Cursor, OpenCode, Amazon Q, Antigravity\n! Space = select, Enter = continue',
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
        'Amazon Q',
        'Antigravity',
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
    'amazonq',
    'antigravity',
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
  assert.ok(await pathExists(path.join(sandbox.home, '.amazonq', 'rules', 'superplan-entry', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.antigravity', 'workflows', 'superplan-entry', 'SKILL.md')));

  const geminiCommand = await fs.readFile(path.join(sandbox.home, '.gemini', 'commands', 'superplan.toml'), 'utf-8');
  assert.match(geminiCommand, /Never create or edit `\.superplan\/changes\/<change-slug>\/tasks\/T-xxx\.md` task contracts with shell loops or direct file-edit rewrites/i);
  assert.match(geminiCommand, /stdin transport into `superplan task batch --stdin --json`/i);
  assert.match(geminiCommand, /launchable companion is installed/i);
  assert.match(geminiCommand, /surface `overlay\.companion\.reason` instead of assuming the overlay appeared/i);
  assert.match(geminiCommand, /Keep workflow control and command-by-command orchestration internal/i);
  assert.match(geminiCommand, /Do not narrate meta progress such as which Superplan skill is active/i);
  assert.match(geminiCommand, /Prefer project thoughts over process thoughts/i);
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
  assert.equal(await pathExists(fakeClaudeDir), true);
  assert.equal(await pathExists(path.join(fakeClaudeDir, 'skills', 'superplan-entry', 'SKILL.md')), true);
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
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context', 'README.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context', 'INDEX.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'runtime')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'decisions.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'gotchas.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')));
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
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context', 'README.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context', 'INDEX.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'runtime')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'decisions.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'gotchas.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')));
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
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'context', 'README.md')));
  assert.ok(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')));
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});
