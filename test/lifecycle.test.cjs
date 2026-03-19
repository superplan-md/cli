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
  assert.ok(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'skills', 'using-superplan', 'SKILL.md')));
  assert.ok(await pathExists(path.join(sandbox.home, '.claude', 'skills', 'using-superplan', 'SKILL.md')));

  const installedUsingSuperplanSkill = await fs.readFile(
    path.join(sandbox.home, '.claude', 'skills', 'using-superplan', 'SKILL.md'),
    'utf-8',
  );
  assert.match(installedUsingSuperplanSkill, /superplan run --json/);
  assert.match(installedUsingSuperplanSkill, /superplan status --json/);
  assert.match(installedUsingSuperplanSkill, /superplan task why-next --json/);
});

test('interactive setup prints a single ascii wordmark that includes .md', async () => {
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
  assert.doesNotMatch(bannerOutput, /SUPERPLAN\.md\s*\n\s*\n/);
  assert.match(bannerOutput, /\.___\s+__\.\s+_______/);
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
  await fs.mkdir(path.join(sandbox.home, '.config', 'superplan', 'skills', 'using-superplan'), { recursive: true });
  await fs.writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n', 'utf-8');
  await fs.writeFile(
    path.join(sandbox.home, '.config', 'superplan', 'skills', 'using-superplan', 'SKILL.md'),
    '# using-superplan\n',
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
  assert.ok(await pathExists(path.join(sandbox.cwd, 'changes')));
});
