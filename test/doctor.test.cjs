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
  readJson,
  runCli,
  withSandboxEnv,
  writeChangeGraph,
  writeFile,
  getSuperplanRoot,
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
  await fs.rm(path.join(getSuperplanRoot(sandbox), 'context', 'README.md'), { force: true });
  await fs.rm(path.join(getSuperplanRoot(sandbox), 'context', 'INDEX.md'), { force: true });
  await fs.rm(path.join(getSuperplanRoot(sandbox), 'decisions.md'), { force: true });
  await fs.rm(path.join(getSuperplanRoot(sandbox), 'gotchas.md'), { force: true });

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), 'version = "0.1"\n');
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'workflow-gap', 'tasks.md'), `# Task Graph

## Graph Metadata
- Change ID: \`workflow-gap\`
- Title: Workflow Gap

## Graph Layout
- \`T-001\` close the workflow gap
  - depends_on_all: []

## Notes
- Test graph.
`);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'workflow-gap', 'tasks', 'T-001.md'), `---
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
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await writeFile(path.join(sandbox.cwd, "dummy.txt"), "dummy");
  await execFileAsync("git", ["add", "-A"], { cwd: sandbox.cwd });
  await execFileAsync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], {
    cwd: sandbox.cwd,
  });

  await writeFile(path.join(sandbox.cwd, 'README.md'), 'drift\n');

  const doctorPayload = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  assert.equal(doctorPayload.ok, true);
  assert.equal(doctorPayload.data.valid, false);
  assert.equal(doctorPayload.data.issues.some(issue => issue.code === 'WORKSPACE_EDITS_WITHOUT_ACTIVE_TASK'), true);
});

test('doctor reports edit scope drift for an active scoped task', async () => {
  const sandbox = await makeSandbox('superplan-doctor-scope-drift-');

  await execFileAsync('git', ['init'], { cwd: sandbox.cwd });
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-001', title: 'Scoped work' },
    ],
  });
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-001.md'), `---
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

  await writeFile(path.join(sandbox.cwd, "dummy.txt"), "dummy");
  await execFileAsync("git", ["add", "-A"], { cwd: sandbox.cwd });
  await execFileAsync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], {
    cwd: sandbox.cwd,
  });

  const runPayload = parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.data.task_id, 'demo/T-001');

  await writeFile(path.join(sandbox.cwd, 'src', 'outside.ts'), 'export const outside = true;\n');

  const doctorPayload = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  assert.equal(doctorPayload.ok, true);
  assert.equal(doctorPayload.data.valid, false);
  assert.equal(doctorPayload.data.issues.some(issue => issue.code === 'WORKSPACE_EDIT_SCOPE_DRIFT'), true);
});

test('doctor baselines pre-existing out-of-scope edits for the current session and only flags new drift', async () => {
  const sandbox = await makeSandbox('superplan-doctor-session-baseline-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };

  await execFileAsync('git', ['init'], { cwd: sandbox.cwd });
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-001', title: 'Scoped work' },
    ],
  });
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-001.md'), `---
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
  await writeFile(path.join(sandbox.cwd, 'dummy.txt'), 'dummy\n');
  await execFileAsync('git', ['add', '-A'], { cwd: sandbox.cwd });
  await execFileAsync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], {
    cwd: sandbox.cwd,
  });

  await writeFile(path.join(sandbox.cwd, 'docs', 'preexisting.md'), 'pre-existing drift\n');

  const runPayload = parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sessionEnv }));
  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.data.task_id, 'demo/T-001');

  const focusState = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'session-focus.json'));
  assert.equal(focusState.sessions['session-A'].worktree_baseline.task_ref, 'demo/T-001');
  assert.equal(typeof focusState.sessions['session-A'].worktree_baseline.snapshot.files['docs/preexisting.md'], 'string');

  const doctorBeforeNewDrift = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sessionEnv }));
  assert.equal(doctorBeforeNewDrift.ok, true);
  assert.equal(doctorBeforeNewDrift.data.issues.some(issue => issue.code === 'WORKSPACE_EDIT_SCOPE_DRIFT'), false);

  await writeFile(path.join(sandbox.cwd, 'src', 'outside.ts'), 'export const outside = true;\n');

  const doctorAfterNewDrift = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sessionEnv }));
  const driftIssue = doctorAfterNewDrift.data.issues.find(issue => issue.code === 'WORKSPACE_EDIT_SCOPE_DRIFT');
  assert.equal(doctorAfterNewDrift.ok, true);
  assert.ok(driftIssue);
  assert.match(driftIssue.message, /src\/outside\.ts/);
  assert.doesNotMatch(driftIssue.message, /docs\/preexisting\.md/);
});

test('doctor does not blame a different session for edits while another session owns the active task', async () => {
  const sandbox = await makeSandbox('superplan-doctor-other-session-active-');
  const sessionAEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };
  const sessionBEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-B',
  };

  await execFileAsync('git', ['init'], { cwd: sandbox.cwd });
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-001', title: 'Scoped work' },
    ],
  });
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-001.md'), `---
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
  await writeFile(path.join(sandbox.cwd, 'dummy.txt'), 'dummy\n');
  await execFileAsync('git', ['add', '-A'], { cwd: sandbox.cwd });
  await execFileAsync('git', ['-c', 'user.name=Test User', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], {
    cwd: sandbox.cwd,
  });

  const runPayload = parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sessionAEnv }));
  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.data.task_id, 'demo/T-001');

  await writeFile(path.join(sandbox.cwd, 'src', 'allowed', 'inside.ts'), 'export const inside = false;\n');

  const doctorPayload = parseCliJson(await runCli(['doctor', '--json'], { cwd: sandbox.cwd, env: sessionBEnv }));
  const issueCodes = new Set(doctorPayload.data.issues.map(issue => issue.code));

  assert.equal(doctorPayload.ok, true);
  assert.equal(issueCodes.has('WORKSPACE_EDITS_WITHOUT_ACTIVE_TASK'), false);
  assert.equal(issueCodes.has('WORKSPACE_EDIT_SCOPE_DRIFT'), false);
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
  assert.equal(await pathExists(path.join(getSuperplanRoot(sandbox), 'context', 'README.md')), true);
  assert.equal(await pathExists(path.join(getSuperplanRoot(sandbox), 'context', 'INDEX.md')), true);
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
  assert.equal(await fs.readFile(path.join(getSuperplanRoot(sandbox), 'context', 'architecture', 'auth.md'), 'utf-8'), '# Auth\n\nContext body\n');
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
  const decisionsContent = await fs.readFile(path.join(getSuperplanRoot(sandbox), 'decisions.md'), 'utf-8');
  assert.match(decisionsContent, /Choose change-scoped plans/);
});

test('doctor reports stale managed execution roots after manual branch drift', async () => {
  const sandbox = await makeSandbox('superplan-doctor-stale-worktree-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };

  await execFileAsync('git', ['init'], { cwd: sandbox.cwd, env: sessionEnv });
  await execFileAsync('git', ['config', 'user.name', 'Superplan Test'], { cwd: sandbox.cwd, env: sessionEnv });
  await execFileAsync('git', ['config', 'user.email', 'superplan@example.com'], { cwd: sandbox.cwd, env: sessionEnv });
  await writeFile(path.join(sandbox.cwd, 'README.md'), '# Test\n');
  await execFileAsync('git', ['add', 'README.md'], { cwd: sandbox.cwd, env: sessionEnv });
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: sandbox.cwd, env: sessionEnv });
  parseCliJson(await runCli(['init', '--yes', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  parseCliJson(await runCli([
    'change', 'new', 'alpha', '--title', 'Alpha', '--single-task', 'Alpha task', '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  parseCliJson(await runCli([
    'change', 'new', 'beta', '--title', 'Beta', '--single-task', 'Beta task', '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  const ensurePayload = parseCliJson(await runCli(['worktree', 'ensure', 'beta', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  await execFileAsync('git', ['checkout', '-B', 'rogue'], {
    cwd: ensurePayload.data.execution_root,
    env: sessionEnv,
  });

  const doctorPayload = parseCliJson(await runCli(['doctor', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));

  assert.equal(doctorPayload.ok, true);
  assert.equal(doctorPayload.data.issues.some(issue => issue.code === 'EXECUTION_ROOT_STALE'), true);
});
