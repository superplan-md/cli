const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadDistModule,
  makeSandbox,
  parseCliJson,
  pathExists,
  runCli,
  withSandboxEnv,
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

  await runCli(['setup', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await writeFile(path.join(sandbox.cwd, '.superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'workflow-gap', 'tasks.md'), `# Task Graph

## Graph Metadata
- Change ID: \`workflow-gap\`
- Title: Workflow Gap

## Graph Layout
- \`T-001\` close the workflow gap
  - depends_on_all: []

## Notes
- Test graph.
`);
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'workflow-gap', 'tasks', 'T-001.md'), `---
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
  assert(issueCodes.has('WORKSPACE_PLAN_MISSING'));
  assert(issueCodes.has('TASK_STATE_DRIFT_PENDING_WITH_COMPLETED_ACCEPTANCE'));
});

test('context bootstrap creates the durable workspace context entrypoints', async () => {
  const sandbox = await makeSandbox('superplan-context-bootstrap-');
  await runCli(['setup', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  const payload = parseCliJson(await runCli(['context', 'bootstrap', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(payload.ok, true);
  assert.equal(payload.data.action, 'bootstrap');
  assert.equal(path.resolve(sandbox.cwd, payload.data.root), path.join(sandbox.cwd, '.superplan'));
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'context', 'README.md')), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'context', 'INDEX.md')), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'decisions.md')), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'gotchas.md')), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'plan.md')), true);
});
