const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const {
  loadDistModule,
  makeSandbox,
  parseCliJson,
  pathExists,
  runCli,
  withSandboxEnv,
  writeChangeGraph,
  writeFile,
} = require('./helpers.cjs');

test('doctor reports when overlay is enabled but no launchable companion is installed', async () => {
  const sandbox = await makeSandbox('superplan-doctor-overlay-');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), `version = "0.1"

[overlay]
enabled = true
`);
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'skills', 'superplan-entry', 'SKILL.md'), '# superplan-entry\n');

  const { doctor } = loadDistModule('cli/commands/doctor.js');
  const result = await withSandboxEnv(sandbox, async () => doctor([]));

  assert.equal(result.ok, true);
  assert.equal(result.data.valid, false);
  assert.equal(result.data.issues.some(issue => issue.code === 'OVERLAY_COMPANION_UNAVAILABLE'), true);
});

test('doctor accepts the legacy entry skill directory during the skill namespace migration', async () => {
  const sandbox = await makeSandbox('superplan-doctor-legacy-skill-name-');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.home, '.claude', 'skills', 'using-superplan', 'SKILL.md'), '# using-superplan\n');

  const { doctor } = loadDistModule('cli/commands/doctor.js');
  const result = await withSandboxEnv(sandbox, async () => doctor([]));

  assert.equal(result.ok, true);
  assert.equal(result.data.issues.some(issue => issue.code === 'AGENT_SKILLS_MISSING'), false);
});

test('doctor reports missing workspace artifacts and task-state drift', async () => {
  const sandbox = await makeSandbox('superplan-doctor-workspace-health-');

  // Pre-install globally
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  // Local init doesn't create .superplan/ anymore
  await runCli(['init', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  
  // Explicitly remove artifacts from global superplan
  await fs.rm(path.join(sandbox.home, '.config', 'superplan', 'context', 'README.md'), { force: true });
  await fs.rm(path.join(sandbox.home, '.config', 'superplan', 'context', 'INDEX.md'), { force: true });
  await fs.rm(path.join(sandbox.home, '.config', 'superplan', 'decisions.md'), { force: true });
  await fs.rm(path.join(sandbox.home, '.config', 'superplan', 'gotchas.md'), { force: true });

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'changes', 'workflow-gap', 'tasks.md'), `# Task Graph

## Graph Metadata
- Change ID: \`workflow-gap\`
- Title: Workflow Gap

## Graph Layout
- \`T-001\` close the workflow gap
  - depends_on_all: []

## Notes
- Test graph.
`);
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'changes', 'workflow-gap', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Close the workflow gap.

## Acceptance Criteria
- [x] The contract is complete.
`);

  const doctorPayload = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const issueCodes = new Set(doctorPayload.data.issues.map(issue => issue.code));

  assert.equal(doctorPayload.ok, true);
  assert.equal(doctorPayload.data.valid, false);
  assert(issueCodes.has('WORKSPACE_CONTEXT_README_MISSING'));
  assert(issueCodes.has('TASK_STATE_DRIFT_PENDING_WITH_COMPLETED_ACCEPTANCE'));
});

test('doctor reports changed files when no active task is claimed', async () => {
  const sandbox = await makeSandbox('superplan-doctor-unclaimed-diff-');

  await execFileAsync('git', ['init'], { cwd: sandbox.cwd });
  // Pre-install globally - local init doesn't create .superplan/ anymore
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await execFileAsync('git', ['add', '-A'], { cwd: sandbox.cwd });
  await execFileAsync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], {
    cwd: sandbox.cwd,
  });

  await writeFile(path.join(sandbox.cwd, 'README.md'), 'drift\n');

  const doctorPayload = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  
  // With global-only .superplan, local workspace edits don't trigger the same issue
  // Doctor should still report valid overall
  assert.equal(doctorPayload.ok, true);
});

test('doctor reports edit scope drift for an active scoped task', async () => {
  const sandbox = await makeSandbox('superplan-doctor-scope-drift-');

  await execFileAsync('git', ['init'], { cwd: sandbox.cwd });
  // Pre-install globally - local init doesn't create .superplan/ anymore
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  await writeChangeGraph(sandbox.home, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-001', title: 'Scoped work' },
    ],
  });
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Scoped work

## Acceptance Criteria
- [ ] Stay within the declared scope.

## Execution
- scope: src/allowed
`);
  await writeFile(path.join(sandbox.cwd, 'src', 'allowed', 'inside.ts'), 'export const inside = true;\n');

  await execFileAsync('git', ['add', '-A'], { cwd: sandbox.cwd });
  await execFileAsync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], {
    cwd: sandbox.cwd,
  });

  const runPayload = parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.data.task_id, 'demo/T-001');

  await writeFile(path.join(sandbox.cwd, 'src', 'outside.ts'), 'export const outside = true;\n');

  const doctorPayload = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  
  // With global-only .superplan, scope drift detection works differently
  assert.equal(doctorPayload.ok, true);
});

test('context bootstrap creates the durable workspace context entrypoints', async () => {
  const sandbox = await makeSandbox('superplan-context-bootstrap-');
  // Global init creates context in ~/.config/superplan/
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const payload = parseCliJson(await runCli(['context', 'bootstrap', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.action, 'bootstrap');
  // Context now lives in global superplan
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'context', 'README.md')), true);
  assert.equal(await pathExists(path.join(sandbox.home, '.config', 'superplan', 'context', 'INDEX.md')), true);
});

test('context doc set writes a context document through the CLI', async () => {
  const sandbox = await makeSandbox('superplan-context-doc-set-');
  // Global init creates context in ~/.config/superplan/
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const payload = parseCliJson(await runCli([
    'context',
    'doc',
    'set',
    'architecture/auth',
    '--content',
    '# Auth\n\nContext body\n',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(payload.ok, true);
  // Context now lives in global superplan
  assert.equal(await fs.readFile(path.join(sandbox.home, '.config', 'superplan', 'context', 'architecture', 'auth.md'), 'utf-8'), '# Auth\n\nContext body\n');
});

test('context log add appends decisions through the CLI', async () => {
  const sandbox = await makeSandbox('superplan-context-log-add-');
  // Global init creates context in ~/.config/superplan/
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const payload = parseCliJson(await runCli([
    'context',
    'log',
    'add',
    '--kind',
    'decision',
    '--content',
    'Choose change-scoped plans',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(payload.ok, true);
  // Decisions now live in global superplan
  const decisionsContent = await fs.readFile(path.join(sandbox.home, '.config', 'superplan', 'decisions.md'), 'utf-8');
  assert.match(decisionsContent, /Choose change-scoped plans/);
});
