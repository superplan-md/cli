const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const EventEmitter = require('node:events');

const {
  loadDistModule,
  makeSandbox,
  withSandboxEnv,
  writeFile,
  writeJson,
} = require('./helpers.cjs');

test('popup snapshot prefers the active task and includes its description', async () => {
  const sandbox = await makeSandbox('superplan-popup-snapshot-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-701.md'), `---
task_id: T-701
status: pending
priority: high
---

## Description
Show this task in the popup

## Acceptance Criteria
- [ ] First thing
`);

  await writeJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'tasks.json'), {
    tasks: {
      'T-701': {
        status: 'in_progress',
        started_at: '2026-03-20T10:00:00.000Z',
      },
    },
  });

  const { getPopupSnapshot } = loadDistModule('cli/commands/popup.js');
  const result = await withSandboxEnv(sandbox, async () => getPopupSnapshot());

  assert.equal(result.ok, true);
  assert.equal(result.data.state, 'active');
  assert.equal(result.data.task_id, 'T-701');
  assert.equal(result.data.description, 'Show this task in the popup');
  assert.equal(result.data.status, 'in_progress');
});

test('popup returns PLATFORM_UNSUPPORTED outside macOS', async () => {
  const { popup } = loadDistModule('cli/commands/popup.js');
  const result = await popup([], { json: true, quiet: true }, {
    platform: 'linux',
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PLATFORM_UNSUPPORTED');
});

test('popup launches the macOS helper and returns the selected task metadata', async () => {
  const sandbox = await makeSandbox('superplan-popup-launch-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-702.md'), `---
task_id: T-702
status: pending
priority: high
---

## Description
Launch the popup for this task

## Acceptance Criteria
- [ ] First thing
`);

  const spawned = [];
  const fakeSpawn = (command, args) => {
    const child = new EventEmitter();
    child.unref = () => {};
    spawned.push({ command, args });
    return child;
  };

  const { popup } = loadDistModule('cli/commands/popup.js');
  const result = await withSandboxEnv(sandbox, async () => popup([], { json: true, quiet: true }, {
    platform: 'darwin',
    spawnFn: fakeSpawn,
    nodeExecPath: '/usr/local/bin/node',
    cliEntryPath: '/tmp/superplan/dist/cli/main.js',
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.launched, true);
  assert.equal(result.data.task_id, 'T-702');
  assert.equal(result.data.state, 'next_ready');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, 'osascript');
  assert.deepEqual(spawned[0].args.slice(0, 2), ['-l', 'JavaScript']);
});
