const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

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
  writeJson,
  getSuperplanRoot,
} = require('./helpers.cjs');

function getRuntimeTask(runtimeState, taskRef) {
  const separatorIndex = taskRef.indexOf('/');
  if (separatorIndex === -1) {
    return undefined;
  }

  const changeId = taskRef.slice(0, separatorIndex);
  const taskId = taskRef.slice(separatorIndex + 1);
  return runtimeState.changes?.[changeId]?.tasks?.[taskId];
}

test('task selector returns the selected task contract and status reflects priority-aware ready selection', async () => {
  const sandbox = await makeSandbox('superplan-task-priority-');
  const { selectNextTask } = loadDistModule('cli/commands/task.js');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-001', title: 'Low priority task' },
      { task_id: 'T-002', title: 'High priority task' },
      { task_id: 'T-003', title: 'Default priority task' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: low
---

## Description
Low priority task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-002.md'), `---
task_id: T-002
status: pending
priority: high
---

## Description
High priority task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-003.md'), `---
task_id: T-003
status: pending
---

## Description
Default priority task

## Acceptance Criteria
- [ ] A
`);

  const nextPayload = await withSandboxEnv(sandbox, async () => selectNextTask());
  assert.equal(nextPayload.ok, true);
  assert.equal(nextPayload.data.task_id, 'demo/T-002');
  assert.equal(nextPayload.data.status, 'ready');
  assert.equal(nextPayload.data.reason, 'Highest priority among ready tasks');
  assert.equal(nextPayload.data.task.task_id, 'T-002');
  assert.equal(nextPayload.data.task.priority, 'high');
  assert.equal(nextPayload.data.task.description, 'High priority task');
  assert.equal(nextPayload.data.task.is_ready, true);

  const statusResult = await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const statusPayload = parseCliJson(statusResult);
  assert.equal(statusPayload.data.active, null);
  assert.deepEqual(statusPayload.data.ready, ['demo/T-002', 'demo/T-003', 'demo/T-001']);
  assert.deepEqual(statusPayload.data.in_review, []);
  assert.deepEqual(statusPayload.data.blocked, []);
  assert.deepEqual(statusPayload.data.needs_feedback, []);
  assert.deepEqual(statusPayload.data.counts, {
    ready: 3,
    in_review: 0,
    blocked: 0,
    needs_feedback: 0,
  });
  assert.equal(statusPayload.data.next_action.type, 'command');
  assert.equal(statusPayload.data.next_action.command, 'superplan run --json');
  assert.equal(statusPayload.error, null);
});

test('run starts the next task, but bare reruns require explicit intent to continue active work', async () => {
  const sandbox = await makeSandbox('superplan-run-loop-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-100', title: 'Run me' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-100.md'), `---
task_id: T-100
status: pending
priority: high
---

## Description
Run me

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(sandbox.cwd, '.codex', 'skills', 'plan-work', 'SKILL.md'), '# plan');
  await writeFile(path.join(sandbox.cwd, '.codex', 'skills', 'verify-ui', 'SKILL.md'), '# verify');
  await writeFile(path.join(sandbox.cwd, 'package.json'), JSON.stringify({
    scripts: {
      start: 'node dist/cli/main.js',
      test: 'node --test',
    },
  }, null, 2));

  const firstRunResult = await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const firstRunPayload = parseCliJson(firstRunResult);
  assert.equal(firstRunPayload.ok, true);
  assert.equal(firstRunPayload.data.task_id, 'demo/T-100');
  assert.equal(firstRunPayload.data.action, 'start');
  assert.equal(firstRunPayload.data.reason, 'Highest priority among ready tasks');
  assert.equal(firstRunPayload.data.task.task_id, 'T-100');
  assert.equal(firstRunPayload.data.task.status, 'in_progress');
  assert.equal(firstRunPayload.data.task.description, 'Run me');
  assert.equal(firstRunPayload.data.active_task_context.task_ref, 'demo/T-100');
  assert.equal(firstRunPayload.data.active_task_context.task_id, 'T-100');
  assert.equal(firstRunPayload.data.active_task_context.change_id, 'demo');
  assert.equal(firstRunPayload.data.active_task_context.task_contract_present, true);
  assert.equal(firstRunPayload.data.active_task_context.environment.SUPERPLAN_ACTIVE_TASK, 'demo/T-100');
  assert.equal(firstRunPayload.data.active_task_context.environment.SUPERPLAN_ACTIVE_CHANGE, 'demo');
  assert.equal(firstRunPayload.data.active_task_context.edit_gate.claimed, true);
  assert.equal(firstRunPayload.data.active_task_context.edit_gate.can_edit, true);
  assert.equal(firstRunPayload.data.active_task_context.execution_handoff.planning_authority, 'repo_harness_first');
  assert.equal(firstRunPayload.data.active_task_context.execution_handoff.execution_authority, 'superplan');
  assert.equal(firstRunPayload.data.active_task_context.execution_handoff.verification_authority, 'repo_harness_first');
  assert.equal(firstRunPayload.data.active_task_context.execution_handoff.workflow_surfaces.planning_surfaces.includes('codex skill: plan-work'), true);
  assert.equal(firstRunPayload.data.active_task_context.execution_handoff.workflow_surfaces.verification_surfaces.includes('codex skill: verify-ui'), true);
  assert.equal(firstRunPayload.data.active_task_context.execution_handoff.workflow_surfaces.verification_surfaces.includes('package script: npm test'), true);
  assert.equal(firstRunPayload.error, null);

  const runtimeState = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'));
  assert.equal(getRuntimeTask(runtimeState, 'demo/T-100').status, 'in_progress');
  assert.ok(getRuntimeTask(runtimeState, 'demo/T-100').started_at);

  const secondRunResult = await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const secondRunPayload = parseCliJson(secondRunResult);
  assert.equal(secondRunPayload.ok, true);
  assert.equal(secondRunPayload.data.task_id, null);
  assert.equal(secondRunPayload.data.action, 'idle');
  assert.equal(secondRunPayload.data.status, null);
  assert.equal(secondRunPayload.data.task, null);
  assert.match(secondRunPayload.data.reason, /demo\/T-100/);
  assert.equal(secondRunPayload.data.next_action.type, 'stop');
  assert.match(secondRunPayload.data.next_action.outcome, /superplan run demo\/T-100 --json/);
  assert.equal(secondRunPayload.error, null);

  const explicitContinuePayload = parseCliJson(await runCli(['run', 'demo/T-100', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(explicitContinuePayload.ok, true);
  assert.equal(explicitContinuePayload.data.task_id, 'demo/T-100');
  assert.equal(explicitContinuePayload.data.action, 'continue');
  assert.equal(explicitContinuePayload.data.reason, 'Task is already in progress');
  assert.equal(explicitContinuePayload.data.task.task_id, 'T-100');
  assert.equal(explicitContinuePayload.data.task.status, 'in_progress');
  assert.equal(explicitContinuePayload.data.active_task_context.environment.SUPERPLAN_ACTIVE_TASK, 'demo/T-100');
});

test('bare run does not auto-resume or replace competing in-progress work from another change', async () => {
  const sandbox = await makeSandbox('superplan-run-competing-active-');

  await writeChangeGraph(sandbox.cwd, 'alpha', {
    title: 'Alpha',
    entries: [
      { task_id: 'T-001', title: 'Alpha active task' },
    ],
  });
  await writeChangeGraph(sandbox.cwd, 'beta', {
    title: 'Beta',
    entries: [
      { task_id: 'T-002', title: 'Beta ready task' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'alpha', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Alpha active task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'beta', 'tasks', 'T-002.md'), `---
task_id: T-002
status: pending
priority: high
---

## Description
Beta ready task

## Acceptance Criteria
- [ ] B
`);

  const alphaStartPayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(alphaStartPayload.ok, true);
  assert.equal(alphaStartPayload.data.action, 'start');

  const competingRunPayload = parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(competingRunPayload.ok, true);
  assert.equal(competingRunPayload.data.task_id, null);
  assert.equal(competingRunPayload.data.action, 'idle');
  assert.match(competingRunPayload.data.reason, /alpha\/T-001/);
  assert.equal(competingRunPayload.data.next_action.type, 'stop');
  assert.match(competingRunPayload.data.next_action.outcome, /superplan run alpha\/T-001 --json/);

  const runtimeStateAfterCompetingRun = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'));
  assert.equal(getRuntimeTask(runtimeStateAfterCompetingRun, 'alpha/T-001').status, 'in_progress');
  assert.equal(getRuntimeTask(runtimeStateAfterCompetingRun, 'beta/T-002'), undefined);
});

test('session focus stays local to the chat, but it does not bypass existing active work in another change', async () => {
  const sandbox = await makeSandbox('superplan-session-focus-');
  const sessionAEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };
  const sessionBEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-B',
  };
  const superplanRoot = getSuperplanRoot(sandbox);

  await fs.mkdir(path.join(superplanRoot, 'changes'), { recursive: true });

  await writeChangeGraph(sandbox.cwd, 'alpha', {
    title: 'Alpha',
    entries: [
      { task_id: 'T-001', title: 'Alpha task' },
    ],
  });

  await writeFile(path.join(superplanRoot, 'changes', 'alpha', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Alpha task

## Acceptance Criteria
- [ ] A
`);

  const alphaStartPayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionAEnv,
  }));
  assert.equal(alphaStartPayload.ok, true);
  assert.equal(alphaStartPayload.data.action, 'start');
  assert.equal(alphaStartPayload.data.task_id, 'alpha/T-001');

  const betaChangePayload = parseCliJson(await runCli([
    'change',
    'new',
    'beta',
    '--title',
    'Beta',
    '--single-task',
    'Beta task',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionBEnv,
  }));
  assert.equal(betaChangePayload.ok, true);
  assert.equal(betaChangePayload.data.change_id, 'beta');

  const betaBareRunPayload = parseCliJson(await runCli(['run', '--json'], {
    cwd: sandbox.cwd,
    env: sessionBEnv,
  }));
  assert.equal(betaBareRunPayload.ok, true);
  assert.equal(betaBareRunPayload.data.task_id, null);
  assert.equal(betaBareRunPayload.data.action, 'idle');
  assert.match(betaBareRunPayload.data.reason, /alpha\/T-001/);
  assert.equal(betaBareRunPayload.data.next_action.type, 'stop');
  assert.match(betaBareRunPayload.data.next_action.outcome, /superplan run alpha\/T-001 --json/);

  const alphaBareRunPayload = parseCliJson(await runCli(['run', '--json'], {
    cwd: sandbox.cwd,
    env: sessionAEnv,
  }));
  assert.equal(alphaBareRunPayload.ok, true);
  assert.equal(alphaBareRunPayload.data.task_id, 'alpha/T-001');
  assert.equal(alphaBareRunPayload.data.action, 'continue');
  assert.match(alphaBareRunPayload.data.reason, /current session focus/);

  const focusState = await readJson(path.join(superplanRoot, 'runtime', 'session-focus.json'));
  assert.equal(focusState.sessions['session-A'].focused_change_id, 'alpha');
  assert.equal(focusState.sessions['session-A'].focused_task_ref, 'alpha/T-001');
  assert.equal(focusState.sessions['session-B'].focused_change_id, 'beta');
  assert.equal(focusState.sessions['session-B'].focused_task_ref, 'beta/T-001');

  const takeoverPayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionBEnv,
  }));
  assert.equal(takeoverPayload.ok, true);
  assert.equal(takeoverPayload.data.task_id, 'alpha/T-001');
  assert.equal(takeoverPayload.data.action, 'continue');

  const sessionBBareRunAfterTakeover = parseCliJson(await runCli(['run', '--json'], {
    cwd: sandbox.cwd,
    env: sessionBEnv,
  }));
  assert.equal(sessionBBareRunAfterTakeover.ok, true);
  assert.equal(sessionBBareRunAfterTakeover.data.task_id, 'alpha/T-001');
  assert.equal(sessionBBareRunAfterTakeover.data.action, 'continue');

  const focusStateAfterTakeover = await readJson(path.join(superplanRoot, 'runtime', 'session-focus.json'));
  assert.equal(focusStateAfterTakeover.sessions['session-B'].focused_change_id, 'alpha');
  assert.equal(focusStateAfterTakeover.sessions['session-B'].focused_task_ref, 'alpha/T-001');
});

test('run --fresh bypasses same-session focus while explicit continue still resumes the old task', async () => {
  const sandbox = await makeSandbox('superplan-run-fresh-same-session-');
  const sessionEnv = {
    ...sandbox.env,
    SUPERPLAN_SESSION_ID: 'session-A',
  };
  const superplanRoot = getSuperplanRoot(sandbox);

  await writeChangeGraph(sandbox.cwd, 'alpha', {
    title: 'Alpha',
    entries: [
      { task_id: 'T-001', title: 'Alpha task' },
    ],
  });

  await writeFile(path.join(superplanRoot, 'changes', 'alpha', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Alpha task

## Acceptance Criteria
- [ ] A
`);

  const alphaStartPayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(alphaStartPayload.ok, true);
  assert.equal(alphaStartPayload.data.task_id, 'alpha/T-001');
  assert.equal(alphaStartPayload.data.action, 'start');

  const betaChangePayload = parseCliJson(await runCli([
    'change',
    'new',
    'beta',
    '--title',
    'Beta',
    '--single-task',
    'Beta task',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(betaChangePayload.ok, true);
  assert.equal(betaChangePayload.data.change_id, 'beta');

  const freshRunPayload = parseCliJson(await runCli(['run', '--fresh', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(freshRunPayload.ok, true);
  assert.equal(freshRunPayload.data.task_id, null);
  assert.equal(freshRunPayload.data.action, 'idle');
  assert.match(freshRunPayload.data.reason, /alpha\/T-001/);
  assert.doesNotMatch(freshRunPayload.data.reason, /current session focus/);
  assert.equal(freshRunPayload.data.next_action.type, 'stop');
  assert.match(freshRunPayload.data.next_action.outcome, /superplan run alpha\/T-001 --json/);

  const explicitContinuePayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sessionEnv,
  }));
  assert.equal(explicitContinuePayload.ok, true);
  assert.equal(explicitContinuePayload.data.task_id, 'alpha/T-001');
  assert.equal(explicitContinuePayload.data.action, 'continue');

  const focusState = await readJson(path.join(superplanRoot, 'runtime', 'session-focus.json'));
  assert.equal(focusState.sessions['session-A'].focused_change_id, 'alpha');
  assert.equal(focusState.sessions['session-A'].focused_task_ref, 'alpha/T-001');
});

test('run with an explicit task id writes runtime state at the repo root workspace', async () => {
  const sandbox = await makeSandbox('superplan-task-nested-runtime-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });
  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-150', title: 'Start from nested cwd' },
    ],
  });
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-150.md'), `---
task_id: T-150
status: pending
priority: high
---

## Description
Start from nested cwd

## Acceptance Criteria
- [ ] Works
`);

  const startPayload = parseCliJson(await runCli(['run', 'demo/T-150', '--json'], {
    cwd: nestedCwd,
    env: sandbox.env,
  }));

  assert.equal(startPayload.data.action, 'start');
  assert.equal(startPayload.data.status, 'in_progress');
  assert.equal(getRuntimeTask(await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json')), 'demo/T-150').status, 'in_progress');
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('qualified task refs remain runnable when multiple changes reuse the same local task id', async () => {
  const sandbox = await makeSandbox('superplan-qualified-task-refs-');

  await writeChangeGraph(sandbox.cwd, 'alpha', {
    title: 'Alpha',
    entries: [
      { task_id: 'T-001', title: 'Alpha task' },
    ],
  });
  await writeChangeGraph(sandbox.cwd, 'beta', {
    title: 'Beta',
    entries: [
      { task_id: 'T-001', title: 'Beta task' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'alpha', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Alpha task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'beta', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Beta task

## Acceptance Criteria
- [ ] B
`);

  const qualifiedRunPayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(qualifiedRunPayload.ok, true);
  assert.equal(qualifiedRunPayload.data.task_id, 'alpha/T-001');
  assert.equal(getRuntimeTask(await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json')), 'alpha/T-001').status, 'in_progress');

  const ambiguousRunPayload = parseCliJson(await runCli(['run', 'T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(ambiguousRunPayload.ok, false);
  assert.equal(ambiguousRunPayload.error.code, 'TASK_ID_AMBIGUOUS');
});

test('runtime auto-migrates a uniquely resolvable legacy bare runtime id on first runtime command', async () => {
  const sandbox = await makeSandbox('superplan-repair-legacy-runtime-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-100', title: 'Repair me' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-100.md'), `---
task_id: T-100
status: pending
priority: high
---

## Description
Repair me

## Acceptance Criteria
- [ ] A
`);

  await writeJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'), {
    tasks: {
      'T-100': {
        status: 'in_progress',
        started_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
      },
    },
  });

  const statusPayload = parseCliJson(await runCli(['status', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(statusPayload.ok, true);

  const runtimeState = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'));
  assert.equal(getRuntimeTask(runtimeState, 'demo/T-100').status, 'in_progress');
});

test('ambiguous legacy bare runtime ids do not shadow qualified change-scoped execution', async () => {
  const sandbox = await makeSandbox('superplan-reset-legacy-runtime-');

  await writeChangeGraph(sandbox.cwd, 'alpha', {
    title: 'Alpha',
    entries: [
      { task_id: 'T-001', title: 'Alpha task' },
    ],
  });
  await writeChangeGraph(sandbox.cwd, 'beta', {
    title: 'Beta',
    entries: [
      { task_id: 'T-001', title: 'Beta task' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'alpha', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Alpha task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'beta', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Beta task

## Acceptance Criteria
- [ ] B
`);

  await writeJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'), {
    tasks: {
      'T-001': {
        status: 'in_progress',
        started_at: '2026-03-27T10:00:00.000Z',
        updated_at: '2026-03-27T10:00:00.000Z',
      },
    },
  });

  const runPayload = parseCliJson(await runCli(['run', 'alpha/T-001', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.data.task_id, 'alpha/T-001');

  const runtimeState = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'));
  assert.equal(getRuntimeTask(runtimeState, 'alpha/T-001').status, 'in_progress');
  assert.equal(getRuntimeTask(runtimeState, 'beta/T-001'), undefined);
});

test('task inspect show surfaces authored execution and verification recipes', async () => {
  const sandbox = await makeSandbox('superplan-task-authored-recipe-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-175', title: 'Add recipe guidance' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-175.md'), `---
task_id: T-175
title: Add recipe guidance
status: pending
priority: high
---

## Description
Add recipe guidance

## Acceptance Criteria
- [ ] A

## Execution
- run: npm start
- note: Requires the built CLI output

## Verification
- verify: npm run build
- verify: npm test
- evidence: Capture the command output in the task notes
`);

  const showPayload = parseCliJson(await runCli(['task', 'inspect', 'show', 'demo/T-175', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(showPayload.ok, true);
  assert.equal(showPayload.data.task.title, 'Add recipe guidance');
  assert.equal(showPayload.data.recipe.source, 'task');
  assert.deepEqual(showPayload.data.recipe.run_commands, ['npm start']);
  assert.deepEqual(showPayload.data.recipe.verify_commands, ['npm run build', 'npm test']);
  assert.deepEqual(showPayload.data.recipe.evidence, ['Capture the command output in the task notes']);
  assert.deepEqual(showPayload.data.recipe.notes, ['Requires the built CLI output']);
});

test('task inspect show infers repo-native verification commands when the task does not declare them', async () => {
  const sandbox = await makeSandbox('superplan-task-inferred-recipe-');

  await writeJson(path.join(sandbox.cwd, 'package.json'), {
    name: 'demo',
    scripts: {
      build: 'tsc',
      test: 'node --test test/*.test.cjs',
      start: 'node dist/cli/main.js',
      'overlay:bundle': 'echo overlay',
    },
  });

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-176', title: 'Improve overlay verification' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-176.md'), `---
task_id: T-176
title: Improve overlay verification
status: pending
priority: high
---

## Description
Improve overlay verification for the CLI.

## Acceptance Criteria
- [ ] Add overlay checks
`);

  const showPayload = parseCliJson(await runCli(['task', 'inspect', 'show', 'demo/T-176', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(showPayload.ok, true);
  assert.equal(showPayload.data.recipe.source, 'repo_inferred');
  assert.deepEqual(showPayload.data.recipe.run_commands, []);
  assert.deepEqual(showPayload.data.recipe.verify_commands, [
    'npm run overlay:bundle',
    'npm run build',
    'npm test',
  ]);
  assert.equal(showPayload.data.recipe.notes.some(note => note.includes('override these repo-default commands')), true);
});

test('task lifecycle supports block, explicit run resume, request-feedback, and reset while appending runtime events', async () => {
  const sandbox = await makeSandbox('superplan-task-lifecycle-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-200', title: 'Lifecycle task' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-200.md'), `---
task_id: T-200
status: pending
priority: high
---

## Description
Lifecycle task

## Acceptance Criteria
- [ ] A
`);

  const startPayload = parseCliJson(await runCli(['run', 'demo/T-200', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(startPayload.data.action, 'start');
  assert.equal(startPayload.data.status, 'in_progress');

  const blockPayload = parseCliJson(await runCli(['task', 'runtime', 'block', 'demo/T-200', '--reason', 'Waiting on review', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(blockPayload.data.status, 'blocked');

  const blockedStatusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(blockedStatusPayload.data.active, null);
  assert.deepEqual(blockedStatusPayload.data.ready, []);
  assert.deepEqual(blockedStatusPayload.data.in_review, []);
  assert.deepEqual(blockedStatusPayload.data.blocked, ['demo/T-200']);
  assert.deepEqual(blockedStatusPayload.data.needs_feedback, []);
  assert.deepEqual(blockedStatusPayload.data.counts, {
    ready: 0,
    in_review: 0,
    blocked: 1,
    needs_feedback: 0,
  });
  assert.equal(blockedStatusPayload.data.next_action.type, 'stop');

  const resumePayload = parseCliJson(await runCli(['run', 'demo/T-200', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(resumePayload.data.action, 'resume');
  assert.equal(resumePayload.data.status, 'in_progress');
  assert.equal(resumePayload.data.reason, 'Task was resumed explicitly');

  const feedbackPayload = parseCliJson(await runCli(['task', 'runtime', 'request-feedback', 'demo/T-200', '--message', 'Please review', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(feedbackPayload.data.status, 'needs_feedback');

  const feedbackStatusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(feedbackStatusPayload.data.active, null);
  assert.deepEqual(feedbackStatusPayload.data.ready, []);
  assert.deepEqual(feedbackStatusPayload.data.in_review, []);
  assert.deepEqual(feedbackStatusPayload.data.blocked, []);
  assert.deepEqual(feedbackStatusPayload.data.needs_feedback, ['demo/T-200']);
  assert.deepEqual(feedbackStatusPayload.data.counts, {
    ready: 0,
    in_review: 0,
    blocked: 0,
    needs_feedback: 1,
  });
  assert.equal(feedbackStatusPayload.data.next_action.type, 'wait_for_user');

  const resetPayload = parseCliJson(await runCli(['task', 'repair', 'reset', 'demo/T-200', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(resetPayload.ok, true);
  assert.equal(resetPayload.data.task_id, 'demo/T-200');
  assert.equal(resetPayload.data.reset, true);
  assert.equal(resetPayload.data.next_action.type, 'command');
  assert.equal(resetPayload.data.next_action.command, 'superplan status --json');
  assert.equal(resetPayload.error, null);

  const eventsContent = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'));
  assert.deepEqual(eventsContent, { changes: {} });

  const eventsFile = await fs.readFile(path.join(getSuperplanRoot(sandbox), 'runtime', 'events.ndjson'), 'utf-8');
  const eventTypes = eventsFile
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line).type);
  assert.deepEqual(eventTypes, [
    'task.started',
    'overlay.ensure',
    'task.blocked',
    'overlay.ensure',
    'task.resumed',
    'overlay.ensure',
    'task.feedback_requested',
    'overlay.ensure',
    'task.reset',
    'overlay.ensure',
  ]);
});

test('task complete auto-finishes routine work and reopen returns it to implementation', async () => {
  const sandbox = await makeSandbox('superplan-task-complete-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-300', title: 'Complete me' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-300.md'), `---
task_id: T-300
status: pending
---

## Description
Complete me

## Acceptance Criteria
- [x] A
- [x] B
`);

  await writeJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'), {
    tasks: {
      'demo/T-300': {
        status: 'in_progress',
        started_at: '2026-03-19T12:00:00.000Z',
      },
    },
  });

  const completePayload = parseCliJson(await runCli(['task', 'review', 'complete', 'demo/T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(completePayload.ok, true);
  assert.equal(completePayload.data.task_id, 'demo/T-300');
  assert.equal(completePayload.data.status, 'done');
  assert.equal(completePayload.data.task.task_id, 'T-300');
  assert.equal(completePayload.data.task.status, 'done');
  assert.equal(completePayload.error, null);

  const showPayload = parseCliJson(await runCli(['task', 'inspect', 'show', 'demo/T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(showPayload.data.task.status, 'done');

  const statusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(statusPayload.data.active, null);
  assert.deepEqual(statusPayload.data.ready, []);
  assert.deepEqual(statusPayload.data.in_review, []);
  assert.deepEqual(statusPayload.data.blocked, []);
  assert.deepEqual(statusPayload.data.needs_feedback, []);
  assert.equal(statusPayload.data.next_action.type, 'stop');

  const reopenPayload = parseCliJson(await runCli(['task', 'review', 'reopen', 'demo/T-300', '--reason', 'Changes requested', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(reopenPayload.ok, true);
  assert.equal(reopenPayload.data.task_id, 'demo/T-300');
  assert.equal(reopenPayload.data.status, 'in_progress');
  assert.equal(reopenPayload.data.task.task_id, 'T-300');
  assert.equal(reopenPayload.data.task.status, 'in_progress');
  assert.equal(reopenPayload.error, null);

  const reopenedShowPayload = parseCliJson(await runCli(['task', 'inspect', 'show', 'demo/T-300', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(reopenedShowPayload.data.task.status, 'in_progress');

  const reopenedStatusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(reopenedStatusPayload.data.active, 'demo/T-300');
  assert.deepEqual(reopenedStatusPayload.data.ready, []);
  assert.deepEqual(reopenedStatusPayload.data.in_review, []);
  assert.deepEqual(reopenedStatusPayload.data.blocked, []);
  assert.deepEqual(reopenedStatusPayload.data.needs_feedback, []);
  assert.deepEqual(reopenedStatusPayload.data.counts, {
    ready: 0,
    in_review: 0,
    blocked: 0,
    needs_feedback: 0,
  });
  assert.equal(reopenedStatusPayload.data.next_action.type, 'command');
  assert.equal(reopenedStatusPayload.data.next_action.command, 'superplan run demo/T-300 --json');

  const eventsFile = await fs.readFile(path.join(getSuperplanRoot(sandbox), 'runtime', 'events.ndjson'), 'utf-8');
  const allEventTypes = eventsFile
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line).type);
  assert.deepEqual(allEventTypes, [
    'task.approved',
    'overlay.ensure',
    'task.reopened',
    'overlay.ensure',
  ]);

  const eventTypes = eventsFile
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(event => event.task_id === 'demo/T-300')
    .map(event => event.type);
  assert.deepEqual(eventTypes, [
    'task.approved',
    'task.reopened',
  ]);
});

test('approve and reopen reject invalid review lifecycle transitions', async () => {
  const sandbox = await makeSandbox('superplan-task-review-errors-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-301', title: 'Review me later' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-301.md'), `---
task_id: T-301
status: pending
---

## Description
Review me later

## Acceptance Criteria
- [x] A
`);

  const approvePayload = parseCliJson(await runCli(['task', 'review', 'approve', 'T-301', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(approvePayload.ok, false);
  assert.equal(approvePayload.error.code, 'TASK_NOT_IN_REVIEW');
  assert.equal(approvePayload.error.message, 'Task is not in review');
  assert.equal(approvePayload.error.retryable, false);
  assert.equal(approvePayload.error.next_action.type, 'stop');

  const reopenPayload = parseCliJson(await runCli(['task', 'review', 'reopen', 'T-301', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(reopenPayload.ok, false);
  assert.equal(reopenPayload.error.code, 'TASK_NOT_REVIEWABLE');
  assert.equal(reopenPayload.error.message, 'Task is not in review or done');
  assert.equal(reopenPayload.error.retryable, false);
  assert.equal(reopenPayload.error.next_action.type, 'stop');
});

test('task fix repairs runtime conflicts and doctor deep reports the remaining structural issues', async () => {
  const sandbox = await makeSandbox('superplan-task-fix-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-401', title: 'Valid task' },
      { task_id: 'T-402', title: 'Broken dependency task', depends_on_all: ['T-999'] },
      { task_id: 'T-999', title: 'Upstream blocker' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-401.md'), `---
task_id: T-401
status: pending
---

## Description
Valid task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-402.md'), `---
task_id: T-402
status: pending
---

## Description
Broken dependency task

## Acceptance Criteria
- [ ] A
`);

  await writeJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'), {
    tasks: {
      'demo/T-401': {
        status: 'in_progress',
        started_at: '2026-03-19T10:00:00.000Z',
      },
      'demo/T-402': {
        status: 'in_progress',
        started_at: '2026-03-19T11:00:00.000Z',
      },
    },
  });

  const deepDoctorBefore = parseCliJson(await runCli(['doctor', '--deep', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const doctorCodesBefore = new Set(deepDoctorBefore.data.issues.map(issue => issue.code));
  assert(doctorCodesBefore.has('BROKEN_DEPENDENCY'));
  assert(doctorCodesBefore.has('RUNTIME_CONFLICT_MULTIPLE_IN_PROGRESS'));

  const fixPayload = parseCliJson(await runCli(['task', 'repair', 'fix', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(fixPayload.ok, true);
  assert.equal(fixPayload.data.fixed, true);
  assert.deepEqual(fixPayload.data.actions, [
    {
      task_id: 'demo/T-401',
      action: 'reset',
    },
    {
      task_id: 'demo/T-402',
      action: 'block',
      reason: 'Dependency not satisfied',
    },
  ]);
  assert.equal(fixPayload.data.next_action.type, 'command');
  assert.equal(fixPayload.data.next_action.command, 'superplan run --json');
  assert.equal(fixPayload.error, null);

  const runtimeState = await readJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'));
  assert.deepEqual(runtimeState, {
    changes: {
      demo: {
        active_task_ref: null,
        updated_at: runtimeState.changes.demo.updated_at,
        tasks: {
          'T-402': {
            status: 'blocked',
            started_at: '2026-03-19T11:00:00.000Z',
            reason: 'Dependency not satisfied',
            updated_at: runtimeState.changes.demo.tasks['T-402'].updated_at,
          },
        },
      },
    },
  });
  assert.ok(runtimeState.changes.demo.tasks['T-402'].updated_at);

  const deepDoctorAfter = parseCliJson(await runCli(['doctor', '--deep', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const doctorCodesAfter = new Set(deepDoctorAfter.data.issues.map(issue => issue.code));
  assert(doctorCodesAfter.has('BROKEN_DEPENDENCY'));
  assert(!doctorCodesAfter.has('RUNTIME_CONFLICT_MULTIPLE_IN_PROGRESS'));
  assert(!doctorCodesAfter.has('RUNTIME_CONFLICT_DEPENDENCY_NOT_SATISFIED'));
});

test('status and run route inconsistent runtime state to repair fix', async () => {
  const sandbox = await makeSandbox('superplan-runtime-repair-routing-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-401', title: 'First task' },
      { task_id: 'T-402', title: 'Second task' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-401.md'), `---
task_id: T-401
status: pending
priority: high
---

## Description
First task

## Acceptance Criteria
- [ ] A
`);

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-402.md'), `---
task_id: T-402
status: pending
priority: high
---

## Description
Second task

## Acceptance Criteria
- [ ] B
`);

  await writeJson(path.join(getSuperplanRoot(sandbox), 'runtime', 'tasks.json'), {
    tasks: {
      'demo/T-401': {
        status: 'in_progress',
        started_at: '2026-03-19T10:00:00.000Z',
      },
      'demo/T-402': {
        status: 'in_progress',
        started_at: '2026-03-19T11:00:00.000Z',
      },
    },
  });

  const statusPayload = parseCliJson(await runCli(['status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(statusPayload.ok, false);
  assert.equal(statusPayload.error.code, 'INVALID_STATE_MULTIPLE_IN_PROGRESS');
  assert.equal(statusPayload.error.next_action.type, 'command');
  assert.equal(statusPayload.error.next_action.command, 'superplan task repair fix --json');

  const runPayload = parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(runPayload.ok, false);
  assert.equal(runPayload.error.code, 'INVALID_STATE_MULTIPLE_IN_PROGRESS');
  assert.equal(runPayload.error.next_action.type, 'command');
  assert.equal(runPayload.error.next_action.command, 'superplan task repair fix --json');
});
