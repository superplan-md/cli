const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadDistModule, makeSandbox, parseCliJson, runCli, withSandboxEnv, writeFile } = require('./helpers.cjs');

test('cli returns NO_COMMAND in json mode', async () => {
  const result = await runCli(['--json']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: 'NO_COMMAND',
      message: 'No command provided',
      retryable: false,
    },
  });
});

test('cli without a command shows the main Superplan command list', async () => {
  const result = await runCli([]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /change\s+Create tracked work structure/);
  assert.match(result.stdout, /setup\s+Setup Superplan on this machine or in this repo/);
  assert.match(result.stdout, /sync\s+Refresh Superplan's view of this repo/);
  assert.match(result.stdout, /update\s+Update the installed Superplan CLI and refresh skills/);
  assert.match(result.stdout, /doctor\s+Validate setup/);
  assert.match(result.stdout, /parse\s+Parse superplan artifacts/);
  assert.match(result.stdout, /purge\s+Purge Superplan installation/);
  assert.match(result.stdout, /status\s+Show current task status summary/);
  assert.match(result.stdout, /task\s+Task runtime and review operations/);
  assert.doesNotMatch(result.stdout, /server\s+Start the local dummy server/);
  assert.doesNotMatch(result.stdout, /popup\s+Open or refocus the current task popup/);
});

test('cli returns version in json mode', async () => {
  const result = await runCli(['--version', '--json']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 0);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.data, {
    version: '0.1.0',
  });
  assert.equal(payload.error, null);
});

test('cli returns UNKNOWN_COMMAND for invalid command', async () => {
  const result = await runCli(['unknown-command', '--json']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: 'UNKNOWN_COMMAND',
      message: 'Unknown command: unknown-command',
      retryable: false,
    },
  });
});

test('server is no longer part of the surfaced command set', async () => {
  const result = await runCli(['server', '--json']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: 'UNKNOWN_COMMAND',
      message: 'Unknown command: server',
      retryable: false,
    },
  });
});

test('task command in quiet mode stays agent-safe json', async () => {
  const result = await runCli(['task', '--quiet']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(payload.error.message, /Available task commands:/);
});

test('task --help explains task subcommands explicitly', async () => {
  const result = await runCli(['task', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Task commands:/);
  assert.match(result.stdout, /new <change-slug>\s+Create a new task file in a change/);
  assert.match(result.stdout, /show <task_id>\s+Show one task and its readiness details/);
  assert.match(result.stdout, /complete <task_id>\s+Finish implementation and send the task to review/);
  assert.match(result.stdout, /approve <task_id>\s+Approve an in-review task and mark it done/);
  assert.match(result.stdout, /reopen <task_id>\s+Move a review or done task back into implementation/);
  assert.match(result.stdout, /block <task_id> --reason\s+Pause a task because something external is blocking it/);
  assert.match(result.stdout, /For a fast start:\s+superplan run/);
  assert.doesNotMatch(result.stdout, /\bcurrent\b/);
  assert.doesNotMatch(result.stdout, /\bnext\b/);
  assert.doesNotMatch(result.stdout, /\bevents\b/);
  assert.doesNotMatch(result.stdout, /\blist\s+List all parsed tasks/);
  assert.doesNotMatch(result.stdout, /\bwhy-next\b/);
  assert.doesNotMatch(result.stdout, /\bwhy <task_id>\b/);
});

test('change --help explains change scaffolding commands', async () => {
  const result = await runCli(['change', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Change commands:/);
  assert.match(result.stdout, /new <slug>\s+Create a new tracked change/);
});

test('task show includes readiness reasons without a separate why command', async () => {
  const sandbox = await makeSandbox('superplan-cli-task-show-why-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
depends_on_all: [T-999]
---

## Description
Blocked by dependency

## Acceptance Criteria
- [ ] A
`);

  const showResult = await runCli(['task', 'show', 'T-001', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const showPayload = parseCliJson(showResult);

  assert.equal(showResult.code, 0);
  assert.equal(showPayload.ok, true);
  assert.equal(showPayload.data.task.task_id, 'T-001');
  assert.equal(Array.isArray(showPayload.data.reasons), true);
  assert.equal(showPayload.data.reasons.includes('DEPENDS_ON_ALL_UNMET'), true);
});

test('removed task diagnostic commands fail fast and point users to the leaner loop', async () => {
  const listPayload = parseCliJson(await runCli(['task', 'list', '--json']));
  assert.equal(listPayload.ok, false);
  assert.equal(listPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(listPayload.error.message, /\bstatus\b/);

  const currentPayload = parseCliJson(await runCli(['task', 'current', '--json']));
  assert.equal(currentPayload.ok, false);
  assert.equal(currentPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(currentPayload.error.message, /\brun\b/);

  const nextPayload = parseCliJson(await runCli(['task', 'next', '--json']));
  assert.equal(nextPayload.ok, false);
  assert.equal(nextPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(nextPayload.error.message, /\brun\b/);

  const whyPayload = parseCliJson(await runCli(['task', 'why', 'T-001', '--json']));
  assert.equal(whyPayload.ok, false);
  assert.equal(whyPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(whyPayload.error.message, /show <task_id>/);

  const whyNextPayload = parseCliJson(await runCli(['task', 'why-next', '--json']));
  assert.equal(whyNextPayload.ok, false);
  assert.equal(whyNextPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(whyNextPayload.error.message, /\brun\b/);

  const eventsPayload = parseCliJson(await runCli(['task', 'events', 'T-001', '--json']));
  assert.equal(eventsPayload.ok, false);
  assert.equal(eventsPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(eventsPayload.error.message, /No direct replacement/);

  const submitReviewPayload = parseCliJson(await runCli(['task', 'submit-review', 'T-001', '--json']));
  assert.equal(submitReviewPayload.ok, false);
  assert.equal(submitReviewPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(submitReviewPayload.error.message, /Use "complete" instead\./);
});

test('setup in human mode prints a concise success message instead of the full payload', async () => {
  const sandbox = await makeSandbox('superplan-setup-human-output-');
  const { routeCommand } = loadDistModule('cli/router.js', {
    select: async () => 'global',
    confirm: async () => false,
  });

  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const output = [];
  const errors = [];
  console.log = (...args) => {
    output.push(args.join(' '));
  };
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    await withSandboxEnv(sandbox, async () => routeCommand(['setup']));
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  const combinedOutput = output.join('\n');
  assert.match(combinedOutput, /Superplan setup completed successfully\./);
  assert.doesNotMatch(combinedOutput, /"config_path"/);
  assert.equal(errors.length, 0);
});
