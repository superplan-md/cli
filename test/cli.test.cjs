const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadDistModule, makeSandbox, parseCliJson, runCli, withSandboxEnv, writeChangeGraph, writeFile } = require('./helpers.cjs');

test('cli returns NO_COMMAND in json mode', async () => {
  const result = await runCli(['--json']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'NO_COMMAND');
  assert.equal(payload.error.message, 'No command provided');
  assert.equal(payload.error.retryable, false);
  assert.equal(payload.error.next_action.type, 'stop');
});

test('cli without a command shows the main Superplan command list', async () => {
  const result = await runCli([]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /Setup:/);
  assert.match(result.stdout, /Authoring:/);
  assert.match(result.stdout, /Execution:/);
  assert.match(result.stdout, /change\s+Create tracked change scaffolding/);
  assert.match(result.stdout, /init\s+Initialize the current repository for Superplan/);
  assert.match(result.stdout, /status\s+Show active, ready, review, blocked, and feedback-needed queues/);
  assert.match(result.stdout, /Diagnostics:/);
  assert.match(result.stdout, /sync\s+Reconcile repo state after task-file edits or runtime drift/);
  assert.match(result.stdout, /validate\s+Validate tasks\.md graph and task-contract consistency/);
  assert.match(result.stdout, /visibility\s+Inspect run visibility and health evidence/);
  assert.match(result.stdout, /doctor\s+Validate install and overlay health/);
  assert.match(result.stdout, /parse\s+Parse task contracts and return diagnostics/);
  assert.match(result.stdout, /Admin:/);
  assert.match(result.stdout, /update\s+Update an installed Superplan CLI and refresh skills/);
  assert.match(result.stdout, /remove\s+Remove Superplan installation or state/);
  assert.doesNotMatch(result.stdout, /popup\s+Open or refocus the current task popup/);
  assert.doesNotMatch(result.stdout, /\bpurge\b/);
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
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
  assert.equal(payload.error.message, 'Unknown command: unknown-command');
  assert.equal(payload.error.retryable, false);
  assert.equal(payload.error.next_action.type, 'stop');
});

test('server is no longer part of the surfaced command set', async () => {
  const result = await runCli(['server', '--json']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
  assert.equal(payload.error.message, 'Unknown command: server');
  assert.equal(payload.error.next_action.type, 'stop');
});

test('purge is no longer part of the surfaced command set', async () => {
  const result = await runCli(['purge', '--json']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'UNKNOWN_COMMAND');
  assert.equal(payload.error.message, 'Unknown command: purge');
  assert.equal(payload.error.next_action.type, 'stop');
});

test('task command in quiet mode stays agent-safe json', async () => {
  const result = await runCli(['task', '--quiet']);
  const payload = parseCliJson(result);

  assert.equal(result.code, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(payload.error.message, /Inspect:/);
  assert.equal(payload.error.next_action.type, 'stop');
});

test('task --help explains task subcommands explicitly', async () => {
  const result = await runCli(['task', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Task lifecycle:/);
  assert.match(result.stdout, /run -> complete/);
  assert.match(result.stdout, /complete verifies acceptance criteria and marks routine work done/);
  assert.match(result.stdout, /Inspect:/);
  assert.match(result.stdout, /Scaffold:/);
  assert.match(result.stdout, /Review:/);
  assert.match(result.stdout, /Runtime:/);
  assert.match(result.stdout, /Repair:/);
  assert.match(result.stdout, /inspect show <task_id>\s+Show one task and its readiness details/);
  assert.match(result.stdout, /scaffold new <change-slug>\s+Scaffold one graph-declared task contract/);
  assert.match(result.stdout, /scaffold batch <change-slug> --stdin\s+Scaffold multiple graph-declared task contracts from JSON stdin/);
  assert.match(result.stdout, /review complete <task_id>\s+Finish implementation and mark the task done when acceptance criteria pass/);
  assert.match(result.stdout, /review approve <task_id>\s+Approve an in-review task and mark it done when strict review is required/);
  assert.match(result.stdout, /review reopen <task_id>\s+Move a review or done task back into implementation/);
  assert.match(result.stdout, /runtime block <task_id> --reason\s+Pause a task because something external is blocking it/);
  assert.match(result.stdout, /For a fast start:\s+superplan run --json/);
  assert.match(result.stdout, /shape changes\/<slug>\/tasks\.md first, validate it, then scaffold task contracts from graph-declared ids/i);
  assert.doesNotMatch(result.stdout, /\bstart <task_id>\b/);
  assert.doesNotMatch(result.stdout, /\bresume <task_id>\b/);
  assert.doesNotMatch(result.stdout, /\bcurrent\b/);
  assert.doesNotMatch(result.stdout, /\bnext\b/);
  assert.doesNotMatch(result.stdout, /\bevents\b/);
  assert.doesNotMatch(result.stdout, /\blist\s+List all parsed tasks/);
  assert.doesNotMatch(result.stdout, /\bwhy-next\b/);
  assert.doesNotMatch(result.stdout, /\bwhy <task_id>\b/);
});

test('remove --help explains the explicit non-interactive agent-safe path', async () => {
  const result = await runCli(['remove', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Remove deletes Superplan installation and state/);
  assert.match(result.stdout, /superplan remove --scope <local\|global\|skip> --yes --json/);
  assert.match(result.stdout, /superplan remove\s+# interactive mode/);
});

test('change --help explains change scaffolding commands', async () => {
  const result = await runCli(['change', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Change commands:/);
  assert.match(result.stdout, /new <slug>\s+Create a new tracked change/);
});

test('task show includes readiness reasons without a separate why command', async () => {
  const sandbox = await makeSandbox('superplan-cli-task-show-why-');

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-001', title: 'Blocked by dependency', depends_on_all: ['T-999'] },
      { task_id: 'T-999', title: 'Upstream blocker' },
    ],
  });
  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
---

## Description
Blocked by dependency

## Acceptance Criteria
- [ ] A
`);

  const showResult = await runCli(['task', 'inspect', 'show', 'T-001', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
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
  assert.match(whyPayload.error.message, /task inspect show <task_id>/);

  const whyNextPayload = parseCliJson(await runCli(['task', 'why-next', '--json']));
  assert.equal(whyNextPayload.ok, false);
  assert.equal(whyNextPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(whyNextPayload.error.message, /\brun\b/);

  const startPayload = parseCliJson(await runCli(['task', 'start', 'T-001', '--json']));
  assert.equal(startPayload.ok, false);
  assert.equal(startPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(startPayload.error.message, /run <task_id>/);

  const resumePayload = parseCliJson(await runCli(['task', 'resume', 'T-001', '--json']));
  assert.equal(resumePayload.ok, false);
  assert.equal(resumePayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(resumePayload.error.message, /run <task_id>/);

  const eventsPayload = parseCliJson(await runCli(['task', 'events', 'T-001', '--json']));
  assert.equal(eventsPayload.ok, false);
  assert.equal(eventsPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(eventsPayload.error.message, /No direct replacement/);

  const submitReviewPayload = parseCliJson(await runCli(['task', 'submit-review', 'T-001', '--json']));
  assert.equal(submitReviewPayload.ok, false);
  assert.equal(submitReviewPayload.error.code, 'INVALID_TASK_COMMAND');
  assert.match(submitReviewPayload.error.message, /Use "task review complete" instead\./);
});

test('overlay show was merged into ensure', async () => {
  const payload = parseCliJson(await runCli(['overlay', 'show', '--json']));

  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'INVALID_OVERLAY_COMMAND');
  assert.match(payload.error.message, /Use "ensure" instead\./);
});

test('init in human mode prints a concise success message instead of the full payload', async () => {
  const sandbox = await makeSandbox('superplan-init-human-output-');
  const { routeCommand } = loadDistModule('cli/router.js', {
    select: async () => 'global',
    confirm: async () => true,
    checkbox: async options => {
      if (!Array.isArray(options?.choices) || options.choices.length === 0) {
        return [];
      }

      return [options.choices[0].value];
    },
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
    await withSandboxEnv(sandbox, async () => routeCommand(['init']));
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  const combinedOutput = output.join('\n');
  assert.match(combinedOutput, /Project initialized successfully/);
  assert.doesNotMatch(combinedOutput, /"config_path"/);
  assert.equal(errors.length, 0);
});

test('init asks for global install and respects the denial', async () => {
  const sandbox = await makeSandbox('superplan-init-global-denial-');
  const { routeCommand } = loadDistModule('cli/router.js', {
    confirm: async ({ message }) => {
      if (message && typeof message === 'string' && message.includes('global configuration not found')) {
        return false;
      }
      return true;
    },
  });

  const output = [];
  const errors = [];
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = (...args) => output.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));

  try {
    await withSandboxEnv(sandbox, async () => routeCommand(['init']));
    const errorOutput = errors.join('\n');
    const payload = JSON.parse(errorOutput);
    assert.equal(payload.ok, false);
    assert.equal(payload.error.code, 'INSTALL_REQUIRED');
    assert.equal(payload.error.message, 'Superplan global installation is required to initialize a project.');
    assert.equal(process.exitCode, 1);
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exitCode = 0;
  }
});
