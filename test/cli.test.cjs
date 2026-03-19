const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCliJson, runCli } = require('./helpers.cjs');

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
  assert.match(result.stdout, /setup\s+Setup Superplan on this machine or in this repo/);
  assert.match(result.stdout, /doctor\s+Validate setup/);
  assert.match(result.stdout, /parse\s+Parse superplan artifacts/);
  assert.match(result.stdout, /popup\s+Open or refocus the current task popup/);
  assert.match(result.stdout, /purge\s+Purge Superplan installation/);
  assert.match(result.stdout, /status\s+Show current task status summary/);
  assert.doesNotMatch(result.stdout, /server\s+Start the local Superplan server/);
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
  assert.match(result.stdout, /next\s+Pick the next ready task/);
  assert.match(result.stdout, /block <task_id> --reason\s+Pause a task because something external is blocking it/);
  assert.match(result.stdout, /For a fast start:\s+superplan run/);
  assert.doesNotMatch(result.stdout, /\bwhy-next\b/);
  assert.doesNotMatch(result.stdout, /\bwhy <task_id>\b/);
});

test('diagnostic task commands still work even when hidden from help', async () => {
  const whyNextResult = await runCli(['task', 'why-next', '--json']);
  const whyNextPayload = parseCliJson(whyNextResult);

  assert.equal(whyNextResult.code, 0);
  assert.equal(whyNextPayload.ok, true);
  assert.equal(typeof whyNextPayload.data.reason, 'string');
});
