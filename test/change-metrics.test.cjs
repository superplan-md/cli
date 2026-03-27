const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const { makeSandbox, parseCliJson, readJson, runCli, writeChangeGraph } = require('./helpers.cjs');

test('change metrics are generated automatically after change creation, scaffolding, and activation', async () => {
  const sandbox = await makeSandbox('superplan-change-metrics-');
  await fs.mkdir(path.join(sandbox.cwd, '.superplan', 'changes'), { recursive: true });

  const changePayload = parseCliJson(await runCli([
    'change',
    'new',
    'auto-metrics',
    '--title',
    'Auto Metrics',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(changePayload.ok, true);

  const metricsPath = path.join(sandbox.cwd, '.superplan', 'changes', 'auto-metrics', 'metrics.json');
  let metrics = await readJson(metricsPath);
  assert.equal(metrics.change_id, 'auto-metrics');
  assert.equal(metrics.created_task_count, 0);
  assert.equal(metrics.total_call_count, 0);
  assert.deepEqual(metrics.tasks, []);

  await writeChangeGraph(sandbox.cwd, 'auto-metrics', {
    title: 'Auto Metrics',
    entries: [
      { task_id: 'T-001', title: 'Measure me' },
    ],
  });

  const scaffoldPayload = parseCliJson(await runCli([
    'task',
    'scaffold',
    'new',
    'auto-metrics',
    '--task-id',
    'T-001',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(scaffoldPayload.ok, true);

  metrics = await readJson(metricsPath);
  assert.equal(metrics.created_task_count, 1);
  assert.equal(metrics.total_call_count, 0);
  assert.deepEqual(metrics.tasks.map(task => task.task_id), ['T-001']);
  assert.equal(metrics.tasks[0].times_called, 0);

  const runPayload = parseCliJson(await runCli([
    'run',
    'auto-metrics/T-001',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.data.task_id, 'auto-metrics/T-001');

  metrics = await readJson(metricsPath);
  assert.equal(metrics.created_task_count, 1);
  assert.equal(metrics.total_call_count, 1);
  assert.equal(metrics.tasks[0].task_ref, 'auto-metrics/T-001');
  assert.equal(metrics.tasks[0].times_called, 1);
});
