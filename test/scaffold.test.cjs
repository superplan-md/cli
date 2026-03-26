const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  pathExists,
  runCli,
  writeChangeGraph,
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
  assert.equal(payload.ok, true);
  assert.equal(payload.data.change_id, 'improve-planning');
  assert.equal(payload.data.root, '.superplan/changes/improve-planning');
  assert.deepEqual(payload.data.files, [
    '.superplan/changes/improve-planning/tasks.md',
    '.superplan/changes/improve-planning/tasks',
    '.superplan/changes/improve-planning/specs/README.md',
  ]);
  assert.equal(payload.data.next_action.type, 'stop');
  assert.equal(payload.error, null);

  const tasksIndexPath = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md');
  assert.equal(await pathExists(tasksIndexPath), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks')), true);
  assert.equal(await pathExists(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'specs', 'README.md')), true);

  const tasksIndexContent = await fs.readFile(tasksIndexPath, 'utf-8');
  assert.match(tasksIndexContent, /# Task Graph/);
  assert.match(tasksIndexContent, /## Graph Metadata/);
  assert.match(tasksIndexContent, /## Graph Layout/);
  assert.match(tasksIndexContent, /## Notes/);
  assert.match(tasksIndexContent, /- Change ID: `improve-planning`/);
  assert.match(tasksIndexContent, /Exact graph syntax the current CLI validates/);
  assert.match(tasksIndexContent, /- `T-001` First task title/);
  assert.match(tasksIndexContent, /- `T-002` Follow-up task title/);
  assert.match(tasksIndexContent, /Do not use subsection-style task entries like:/);
  assert.match(tasksIndexContent, /Author task entries in the exact `- `T-xxx` Title` graph format shown above before scaffolding task contracts with the CLI\./);
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
  assert.equal(payload.ok, true);
  assert.equal(payload.data.change_id, 'improve-planning');
  assert.equal(payload.data.root, path.relative(nestedCwd, changeRoot) || changeRoot);
  assert.deepEqual(payload.data.files, [
    path.relative(nestedCwd, path.join(changeRoot, 'tasks.md')) || path.join(changeRoot, 'tasks.md'),
    path.relative(nestedCwd, path.join(changeRoot, 'tasks')) || path.join(changeRoot, 'tasks'),
    path.relative(nestedCwd, path.join(changeRoot, 'specs', 'README.md')) || path.join(changeRoot, 'specs', 'README.md'),
  ]);
  assert.equal(payload.data.next_action.type, 'stop');
  assert.equal(payload.error, null);
  assert.equal(await pathExists(path.join(changeRoot, 'tasks.md')), true);
  assert.equal(await pathExists(path.join(changeRoot, 'specs', 'README.md')), true);
  assert.equal(await pathExists(path.join(nestedCwd, '.superplan')), false);
});

test('task scaffold new scaffolds a contract for a graph-declared task id without mutating tasks.md', async () => {
  const sandbox = await makeSandbox('superplan-task-new-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  await writeChangeGraph(sandbox.cwd, 'improve-planning', {
    title: 'Improve Planning',
    entries: [
      {
        task_id: 'T-001',
        title: 'Add scaffolding command',
      },
      {
        task_id: 'T-002',
        title: 'Add help coverage',
      },
    ],
  });

  const firstTaskPayload = parseCliJson(await runCli([
    'task',
    'scaffold',
    'new',
    'improve-planning',
    '--task-id',
    'T-001',
    '--priority',
    'high',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(firstTaskPayload.ok, true);
  assert.equal(firstTaskPayload.data.task_id, 'improve-planning/T-001');
  assert.equal(firstTaskPayload.data.change_id, 'improve-planning');
  assert.equal(firstTaskPayload.data.path, '.superplan/changes/improve-planning/tasks/T-001.md');
  assert.equal(firstTaskPayload.data.task.task_id, 'T-001');
  assert.equal(firstTaskPayload.data.task.change_id, 'improve-planning');
  assert.equal(firstTaskPayload.data.task.task_ref, 'improve-planning/T-001');
  assert.match(firstTaskPayload.data.task.task_file_path, /\/\.superplan\/changes\/improve-planning\/tasks\/T-001\.md$/);
  assert.equal(firstTaskPayload.data.task.status, 'pending');
  assert.equal(firstTaskPayload.data.task.priority, 'high');
  assert.deepEqual(firstTaskPayload.data.task.depends_on_all, []);
  assert.deepEqual(firstTaskPayload.data.task.depends_on_any, []);
  assert.equal(firstTaskPayload.data.task.description, 'Add scaffolding command');
  assert.deepEqual(firstTaskPayload.data.task.acceptance_criteria, [
    {
      text: 'Define the first acceptance criterion.',
      done: false,
    },
  ]);
  assert.equal(firstTaskPayload.data.task.total_acceptance_criteria, 1);
  assert.equal(firstTaskPayload.data.task.completed_acceptance_criteria, 0);
  assert.equal(firstTaskPayload.data.task.progress_percent, 0);
  assert.equal(firstTaskPayload.data.task.effective_status, 'draft');
  assert.equal(firstTaskPayload.data.task.is_valid, true);
  assert.equal(firstTaskPayload.data.task.is_ready, true);
  assert.deepEqual(firstTaskPayload.data.task.issues, []);
  assert.equal(firstTaskPayload.data.next_action.type, 'command');
  assert.equal(firstTaskPayload.data.next_action.command, 'superplan run improve-planning/T-001 --json');
  assert.equal(firstTaskPayload.error, null);

  const secondTaskPayload = parseCliJson(await runCli([
    'task',
    'scaffold',
    'new',
    'improve-planning',
    '--task-id',
    'T-002',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(secondTaskPayload.data.task_id, 'improve-planning/T-002');

  parseCliJson(await runCli(['change', 'new', 'release-polish', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  await writeChangeGraph(sandbox.cwd, 'release-polish', {
    title: 'Release Polish',
    entries: [
      {
        task_id: 'T-003',
        title: 'Add release notes',
      },
    ],
  });

  const thirdTaskPayload = parseCliJson(await runCli([
    'task',
    'scaffold',
    'new',
    'release-polish',
    '--task-id',
    'T-003',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(thirdTaskPayload.ok, true);
  assert.equal(thirdTaskPayload.data.task_id, 'release-polish/T-003');
  assert.equal(thirdTaskPayload.data.change_id, 'release-polish');
  assert.equal(thirdTaskPayload.data.path, '.superplan/changes/release-polish/tasks/T-003.md');
  assert.equal(thirdTaskPayload.data.task.task_id, 'T-003');
  assert.equal(thirdTaskPayload.data.task.change_id, 'release-polish');
  assert.equal(thirdTaskPayload.data.task.task_ref, 'release-polish/T-003');
  assert.match(thirdTaskPayload.data.task.task_file_path, /\/\.superplan\/changes\/release-polish\/tasks\/T-003\.md$/);
  assert.equal(thirdTaskPayload.data.task.status, 'pending');
  assert.equal(thirdTaskPayload.data.task.priority, 'medium');
  assert.deepEqual(thirdTaskPayload.data.task.depends_on_all, []);
  assert.deepEqual(thirdTaskPayload.data.task.depends_on_any, []);
  assert.equal(thirdTaskPayload.data.task.description, 'Add release notes');
  assert.deepEqual(thirdTaskPayload.data.task.acceptance_criteria, [
    {
      text: 'Define the first acceptance criterion.',
      done: false,
    },
  ]);
  assert.equal(thirdTaskPayload.data.task.total_acceptance_criteria, 1);
  assert.equal(thirdTaskPayload.data.task.completed_acceptance_criteria, 0);
  assert.equal(thirdTaskPayload.data.task.progress_percent, 0);
  assert.equal(thirdTaskPayload.data.task.effective_status, 'draft');
  assert.equal(thirdTaskPayload.data.task.is_valid, true);
  assert.equal(thirdTaskPayload.data.task.is_ready, true);
  assert.deepEqual(thirdTaskPayload.data.task.issues, []);
  assert.equal(thirdTaskPayload.data.next_action.type, 'command');
  assert.equal(thirdTaskPayload.data.next_action.command, 'superplan run release-polish/T-003 --json');
  assert.equal(thirdTaskPayload.error, null);

  const firstTaskPath = path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks', 'T-001.md');
  const firstTaskContent = await fs.readFile(firstTaskPath, 'utf-8');
  assert.match(firstTaskContent, /task_id: T-001/);
  assert.match(firstTaskContent, /priority: high/);
  assert.match(firstTaskContent, /## Description\nAdd scaffolding command/);
  assert.match(firstTaskContent, /## Acceptance Criteria\n- \[ \] Define the first acceptance criterion\./);
  assert.doesNotMatch(firstTaskContent, /depends_on_all:/);
  assert.doesNotMatch(firstTaskContent, /depends_on_any:/);

  const tasksIndexContent = await fs.readFile(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md'), 'utf-8');
  assert.match(tasksIndexContent, /- `T-001` Add scaffolding command/);
  assert.match(tasksIndexContent, /- `T-002` Add help coverage/);

  const secondChangeIndexContent = await fs.readFile(path.join(sandbox.cwd, '.superplan', 'changes', 'release-polish', 'tasks.md'), 'utf-8');
  assert.match(secondChangeIndexContent, /- `T-003` Add release notes/);

  const parsePayload = parseCliJson(await runCli(['parse', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const diagnosticCodes = new Set(parsePayload.data.diagnostics.map(diagnostic => diagnostic.code));
  assert.equal(diagnosticCodes.has('DUPLICATE_TASK_ID'), false);
});

test('task scaffold batch scaffolds graph-declared task ids and parse derives dependencies from tasks.md', async () => {
  const sandbox = await makeSandbox('superplan-task-batch-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  await writeChangeGraph(sandbox.cwd, 'improve-planning', {
    title: 'Improve Planning',
    entries: [
      {
        task_id: 'T-001',
        title: 'Add scaffolding command',
      },
      {
        task_id: 'T-002',
        title: 'Add help coverage',
        depends_on_all: ['T-001'],
      },
    ],
  });

  const batchPayloadInput = JSON.stringify({
    tasks: [
      {
        task_id: 'T-001',
        priority: 'high',
        description: 'Create the batch task scaffolding flow.',
        acceptance_criteria: [
          'Batch creation reads a JSON payload from stdin.',
          'Created tasks get stable IDs.',
        ],
      },
      {
        task_id: 'T-002',
        acceptance_criteria: [
          'Task help documents the batch subcommand.',
        ],
      },
    ],
  });

  const batchPayload = parseCliJson(await runCli([
    'task',
    'scaffold',
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
      ref: 'improve-planning/T-001',
      title: 'Add scaffolding command',
      path: '.superplan/changes/improve-planning/tasks/T-001.md',
    },
    {
      task_id: 'T-002',
      ref: 'improve-planning/T-002',
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
  assert.match(secondTaskContent, /## Description\nAdd help coverage/);
  assert.doesNotMatch(secondTaskContent, /depends_on_all:/);

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

test('task scaffold batch fails before writing when a task id is not declared in the graph', async () => {
  const sandbox = await makeSandbox('superplan-task-batch-invalid-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  await writeChangeGraph(sandbox.cwd, 'improve-planning', {
    title: 'Improve Planning',
    entries: [
      {
        task_id: 'T-001',
        title: 'Add scaffolding command',
      },
    ],
  });

  const result = await runCli([
    'task',
    'scaffold',
    'batch',
    'improve-planning',
    '--stdin',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
    input: JSON.stringify([
      {
        task_id: 'T-999',
      },
    ]),
  });
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'TASK_NOT_IN_GRAPH');

  const taskEntries = await fs.readdir(path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks'));
  assert.deepEqual(taskEntries, []);

  const tasksIndexContent = await fs.readFile(
    path.join(sandbox.cwd, '.superplan', 'changes', 'improve-planning', 'tasks.md'),
    'utf-8',
  );
  assert.match(tasksIndexContent, /- `T-001` Add scaffolding command/);
});

test('task scaffold batch using stdin fails clearly when the payload is empty', async () => {
  const sandbox = await makeSandbox('superplan-task-batch-empty-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'improve-planning', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  const result = await runCli([
    'task',
    'scaffold',
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
