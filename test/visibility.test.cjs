const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  makeSandbox,
  parseCliJson,
  readJson,
  runCli,
  writeChangeGraph,
  writeFile,
} = require('./helpers.cjs');

function parseEvents(content) {
  return content
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('visibility report summarizes an active run, enriches events, and writes repo-local reports', async () => {
  const sandbox = await makeSandbox('superplan-visibility-active-run-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-400', title: 'Track an active visibility run' },
    ],
  });

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-400.md'), `---
task_id: T-400
status: pending
priority: high
---

## Description
Track an active visibility run

## Acceptance Criteria
- [ ] A
`);

  const runPayload = parseCliJson(await runCli(['run', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(runPayload.ok, true);
  assert.equal(runPayload.data.task_id, 'demo/T-400');

  const blockPayload = parseCliJson(await runCli(['task', 'runtime', 'block', 'demo/T-400', '--reason', 'Waiting on review', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(blockPayload.ok, true);

  const reportPayload = parseCliJson(await runCli(['visibility', 'report', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(reportPayload.ok, true);
  assert.equal(reportPayload.data.report.status, 'active');
  assert.equal(typeof reportPayload.data.report.run_id, 'string');
  assert.equal(reportPayload.data.report.counts.task_started, 1);
  assert.equal(reportPayload.data.report.counts.task_blocked, 1);
  assert.equal(reportPayload.data.report.layers.interruption_recovery.status, 'attention');
  assert.equal(reportPayload.data.report.layers.overlay.status, 'disabled');

  const events = parseEvents(await fs.readFile(path.join(sandbox.cwd, '.superplan', 'runtime', 'events.ndjson'), 'utf-8'));
  assert.equal(events.length, 4);
  assert.equal(events[0].run_id, reportPayload.data.report.run_id);
  assert.equal(events[0].command, 'run');
  assert.equal(events[0].workflow_phase, 'execution');
  assert.equal(events[0].outcome, 'success');
  assert.equal(events[1].run_id, reportPayload.data.report.run_id);
  assert.equal(events[1].command, 'run');
  assert.equal(events[1].type, 'overlay.ensure');
  assert.equal(events[1].workflow_phase, 'overlay');
  assert.equal(events[2].run_id, reportPayload.data.report.run_id);
  assert.equal(events[2].command, 'task runtime block');
  assert.equal(events[2].workflow_phase, 'feedback');
  assert.equal(events[2].reason_code, 'Waiting on review');
  assert.equal(events[3].run_id, reportPayload.data.report.run_id);
  assert.equal(events[3].command, 'task runtime block');
  assert.equal(events[3].type, 'overlay.ensure');
  assert.equal(events[3].workflow_phase, 'overlay');

  const latestReport = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'reports', 'latest.json'));
  assert.equal(latestReport.run_id, reportPayload.data.report.run_id);

  const persistedRunReport = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'reports', `${reportPayload.data.report.run_id}.json`));
  assert.equal(persistedRunReport.run_id, reportPayload.data.report.run_id);
});

test('visibility report closes completed runs and includes overlay and doctor health signals', async () => {
  const sandbox = await makeSandbox('superplan-visibility-completed-run-');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), `version = "0.1"

[overlay]
enabled = true
`);
  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'skills', 'using-superplan', 'SKILL.md'), '# using-superplan\n');
  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-401', title: 'Finish a complete visibility run' },
    ],
  });
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-401.md'), `---
task_id: T-401
status: pending
priority: high
---

## Description
Finish a complete visibility run

## Acceptance Criteria
- [x] A
`);
  await writeFile(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'), JSON.stringify({
    tasks: {
      'demo/T-401': {
        status: 'in_progress',
        started_at: '2026-03-21T11:20:00.000Z',
        updated_at: '2026-03-21T11:20:00.000Z',
      },
    },
  }, null, 2));

  const completePayload = parseCliJson(await runCli(['task', 'review', 'complete', 'demo/T-401', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  assert.equal(completePayload.ok, true);

  const reportPayload = parseCliJson(await runCli(['visibility', 'report', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(reportPayload.ok, true);
  assert.equal(reportPayload.data.report.status, 'completed');
  assert.equal(typeof reportPayload.data.report.ended_at, 'string');
  assert.equal(reportPayload.data.report.counts.task_approved, 1);
  assert.equal(reportPayload.data.report.layers.review.status, 'healthy');
  assert.equal(reportPayload.data.report.layers.overlay.status, 'attention');
  assert.equal(reportPayload.data.report.doctor.valid, false);
  assert.equal(
    reportPayload.data.report.doctor.issues.some(issue => issue.code === 'OVERLAY_COMPANION_UNAVAILABLE'),
    true,
  );

  const sessionState = await readJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'session.json'));
  assert.equal(sessionState.status, 'closed');
  assert.equal(sessionState.run_id, reportPayload.data.report.run_id);
});

test('visibility report stays backward-compatible with legacy event lines that lack run metadata', async () => {
  const sandbox = await makeSandbox('superplan-visibility-legacy-events-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'runtime', 'events.ndjson'), [
    JSON.stringify({ ts: 1774017763869, type: 'task.started', task_id: 'T-003' }),
    JSON.stringify({ ts: 1774039545073, type: 'task.review_requested', task_id: 'T-003' }),
  ].join('\n'));

  const reportPayload = parseCliJson(await runCli(['visibility', 'report', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(reportPayload.ok, true);
  assert.equal(reportPayload.data.report.run_id, 'legacy-history');
  assert.equal(reportPayload.data.report.counts.task_started, 1);
  assert.equal(reportPayload.data.report.counts.task_review_requested, 1);
});
