const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  pathExists,
  runCli,
} = require('./helpers.cjs');

test('change new creates a canonical change skeleton', async () => {
  const sandbox = await makeSandbox('superplan-change-new-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  const result = await runCli(['change', 'new', 'improve-planning', '--title', 'Improve Planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      change_id: 'improve-planning',
      root: '.superplan/changes/improve-planning',
      files: [
        '.superplan/changes/improve-planning/tasks.md',
        '.superplan/changes/improve-planning/tasks',
      ],
    },
    error: null,
  });

  const tasksIndexPath = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md');
  assert.equal(await pathExists(tasksIndexPath), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks')), true);

  const tasksIndexContent = await fs.readFile(tasksIndexPath, 'utf-8');
  assert.match(tasksIndexContent, /# Improve Planning/);
  assert.match(tasksIndexContent, /- Change ID: `improve-planning`/);
  assert.match(tasksIndexContent, /## Tasks/);
  assert.match(tasksIndexContent, /Do not hand-create `tasks\/T-xxx\.md`\./);
  assert.match(tasksIndexContent, /Shape the graph and dependencies here first, then mint executable tasks with `superplan task new` or `superplan task batch`\./);
});

test('change new from a nested repo directory uses the repo-root superplan workspace', async () => {
  const sandbox = await makeSandbox('superplan-change-new-nested-');
  const nestedCwd = path.join(sandbox.cwd, 'apps', 'overlay-desktop');
  const changeRoot = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning');

  await fs.mkdir(path.join(sandbox.cwd, '.git'), { recursive: true });
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });
  await fs.mkdir(nestedCwd, { recursive: true });

  const result = await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: nestedCwd,
    env: sandbox.env,
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.deepEqual(payload, {
    ok: true,
    data: {
      change_id: 'improve-planning',
      root: path.relative(nestedCwd, changeRoot) || changeRoot,
      files: [
        path.relative(nestedCwd, path.join(changeRoot, 'tasks.md')) || path.join(changeRoot, 'tasks.md'),
        path.relative(nestedCwd, path.join(changeRoot, 'tasks')) || path.join(changeRoot, 'tasks'),
      ],
    },
    error: null,
  });
  assert.equal(await pathExists(path.join(changeRoot, 'tasks.md')), true);
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('task new creates globally unique task contracts and updates each change index', async () => {
  const sandbox = await makeSandbox('superplan-task-new-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const firstTaskPayload = parseCliJson(await runCli([
    'task',
    'new',
    'improve-planning',
    '--title',
    'Add scaffolding command',
    '--priority',
    'high',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.deepEqual(firstTaskPayload, {
    ok: true,
    data: {
      task_id: 'T-001',
      change_id: 'improve-planning',
      path: '.superplan/changes/improve-planning/tasks/T-001.md',
      task: {
        task_id: 'T-001',
        status: 'pending',
        priority: 'high',
        depends_on_all: [],
        depends_on_any: [],
        description: 'Add scaffolding command',
        acceptance_criteria: [
          {
            text: 'Define the first acceptance criterion.',
            done: false,
          },
        ],
        total_acceptance_criteria: 1,
        completed_acceptance_criteria: 0,
        progress_percent: 0,
        effective_status: 'draft',
        is_valid: true,
        is_ready: true,
        issues: [],
      },
    },
    error: null,
  });

  const secondTaskPayload = parseCliJson(await runCli([
    'task',
    'new',
    'improve-planning',
    '--title',
    'Add help coverage',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(secondTaskPayload.data.task_id, 'T-002');

  parseCliJson(await runCli(['change', 'new', 'release-polish', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const thirdTaskPayload = parseCliJson(await runCli([
    'task',
    'new',
    'release-polish',
    '--title',
    'Add release notes',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.deepEqual(thirdTaskPayload, {
    ok: true,
    data: {
      task_id: 'T-003',
      change_id: 'release-polish',
      path: '.superplan/changes/release-polish/tasks/T-003.md',
      task: {
        task_id: 'T-003',
        status: 'pending',
        priority: 'medium',
        depends_on_all: [],
        depends_on_any: [],
        description: 'Add release notes',
        acceptance_criteria: [
          {
            text: 'Define the first acceptance criterion.',
            done: false,
          },
        ],
        total_acceptance_criteria: 1,
        completed_acceptance_criteria: 0,
        progress_percent: 0,
        effective_status: 'draft',
        is_valid: true,
        is_ready: true,
        issues: [],
      },
    },
    error: null,
  });

  const firstTaskPath = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks', 'T-001.md');
  const firstTaskContent = await fs.readFile(firstTaskPath, 'utf-8');
  assert.match(firstTaskContent, /task_id: T-001/);
  assert.match(firstTaskContent, /priority: high/);
  assert.match(firstTaskContent, /## Description\nAdd scaffolding command/);
  assert.match(firstTaskContent, /## Acceptance Criteria\n- \[ \] Define the first acceptance criterion\./);

  const tasksIndexContent = await fs.readFile(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md'), 'utf-8');
  assert.match(tasksIndexContent, /- `T-001` Add scaffolding command/);
  assert.match(tasksIndexContent, /- `T-002` Add help coverage/);

  const secondChangeIndexContent = await fs.readFile(path.join(sandbox.cwd, '.superplan', 'changes', 'release-polish', 'tasks.md'), 'utf-8');
  assert.match(secondChangeIndexContent, /- `T-003` Add release notes/);

  const parsePayload = parseCliJson(await runCli(['parse', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const diagnosticCodes = new Set(parsePayload.data.diagnostics.map(diagnostic => diagnostic.code));
  assert.equal(diagnosticCodes.has('DUPLICATE_TASK_ID'), false);
});

test('task batch creates multiple task contracts from one JSON spec and resolves batch refs', async () => {
  const sandbox = await makeSandbox('superplan-task-batch-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const batchPayloadInput = JSON.stringify({
    tasks: [
      {
        ref: 'scaffold',
        title: 'Add scaffolding command',
        priority: 'high',
        description: 'Create the batch task scaffolding flow.',
        acceptance_criteria: [
          'Batch creation reads a JSON payload from stdin.',
          'Created tasks get stable IDs.',
        ],
      },
      {
        ref: 'tests',
        title: 'Add help coverage',
        depends_on_all_refs: ['scaffold'],
        acceptance_criteria: [
          'Task help documents the batch subcommand.',
        ],
      },
    ],
  });

  const batchPayload = parseCliJson(await runCli([
    'task',
    'batch',
    'improve-planning',
    '--stdin',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
    input: batchPayloadInput,
  }));

  assert.equal(batchPayload.ok, true);
  assert.equal(batchPayload.error, null);
  assert.equal(batchPayload.data.change_id, 'improve-planning');
  assert.deepEqual(batchPayload.data.created, [
    {
      task_id: 'T-001',
      ref: 'scaffold',
      title: 'Add scaffolding command',
      path: '.superplan/changes/improve-planning/tasks/T-001.md',
    },
    {
      task_id: 'T-002',
      ref: 'tests',
      title: 'Add help coverage',
      path: '.superplan/changes/improve-planning/tasks/T-002.md',
    },
  ]);
  assert.equal(Array.isArray(batchPayload.data.tasks), true);
  assert.equal(batchPayload.data.tasks.length, 2);
  assert.equal(batchPayload.data.tasks[0].task_id, 'T-001');
  assert.equal(batchPayload.data.tasks[0].priority, 'high');
  assert.equal(batchPayload.data.tasks[1].task_id, 'T-002');
  assert.deepEqual(batchPayload.data.tasks[1].depends_on_all, ['T-001']);

  const firstTaskContent = await fs.readFile(
    path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks', 'T-001.md'),
    'utf-8',
  );
  assert.match(firstTaskContent, /priority: high/);
  assert.match(firstTaskContent, /## Description\nCreate the batch task scaffolding flow\./);
  assert.match(firstTaskContent, /- \[ \] Batch creation reads a JSON payload from stdin\./);

  const secondTaskContent = await fs.readFile(
    path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks', 'T-002.md'),
    'utf-8',
  );
  assert.match(secondTaskContent, /depends_on_all: \["T-001"\]/);
  assert.match(secondTaskContent, /## Description\nAdd help coverage/);

  const tasksIndexContent = await fs.readFile(
    path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md'),
    'utf-8',
  );
  assert.match(tasksIndexContent, /- `T-001` Add scaffolding command/);
  assert.match(tasksIndexContent, /- `T-002` Add help coverage/);

  const parsePayload = parseCliJson(await runCli(['parse', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const parsedBatchTask = parsePayload.data.tasks.find(task => task.task_id === 'T-002');
  assert.deepEqual(parsedBatchTask.depends_on_all, ['T-001']);
});

test('task batch fails before writing when a dependency ref is unknown', async () => {
  const sandbox = await makeSandbox('superplan-task-batch-invalid-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const result = await runCli([
    'task',
    'batch',
    'improve-planning',
    '--stdin',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
    input: JSON.stringify([
      {
        title: 'Add scaffolding command',
        depends_on_all_refs: ['missing-ref'],
      },
    ]),
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'TASK_BATCH_UNKNOWN_REF');

  const taskEntries = await fs.readdir(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks'));
  assert.deepEqual(taskEntries, []);

  const tasksIndexContent = await fs.readFile(
    path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md'),
    'utf-8',
  );
  assert.match(tasksIndexContent, /Do not hand-create `tasks\/T-xxx\.md`\./);
  assert.match(tasksIndexContent, /Shape the graph and dependencies here first, then mint executable tasks with `superplan task new` or `superplan task batch`\./);
});

test('task batch using stdin fails clearly when the payload is empty', async () => {
  const sandbox = await makeSandbox('superplan-task-batch-empty-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const result = await runCli([
    'task',
    'batch',
    'improve-planning',
    '--stdin',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
    input: '',
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'TASK_BATCH_STDIN_EMPTY');
});
