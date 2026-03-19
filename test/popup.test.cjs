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
    isProcessAlive: () => false,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.data.launched, true);
  assert.equal(result.data.already_running, false);
  assert.equal(result.data.task_id, 'T-702');
  assert.equal(result.data.state, 'next_ready');
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].command, 'osascript');
  assert.deepEqual(spawned[0].args.slice(0, 2), ['-l', 'JavaScript']);
});

test('popup does not launch a duplicate helper when one is already running', async () => {
  const sandbox = await makeSandbox('superplan-popup-dedupe-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-703.md'), `---
task_id: T-703
status: pending
priority: high
---

## Description
Keep a single popup window for this task

## Acceptance Criteria
- [ ] First thing
`);

  const spawned = [];
  const fakeSpawn = (command, args) => {
    const child = new EventEmitter();
    child.pid = 4321;
    child.unref = () => {};
    spawned.push({ command, args });
    return child;
  };

  const { popup } = loadDistModule('cli/commands/popup.js');

  const firstResult = await withSandboxEnv(sandbox, async () => popup([], { json: true, quiet: true }, {
    platform: 'darwin',
    spawnFn: fakeSpawn,
    nodeExecPath: '/usr/local/bin/node',
    cliEntryPath: '/tmp/superplan/dist/cli/main.js',
    isProcessAlive: pid => pid === 4321,
  }));

  const secondResult = await withSandboxEnv(sandbox, async () => popup([], { json: true, quiet: true }, {
    platform: 'darwin',
    spawnFn: fakeSpawn,
    nodeExecPath: '/usr/local/bin/node',
    cliEntryPath: '/tmp/superplan/dist/cli/main.js',
    isProcessAlive: pid => pid === 4321,
  }));

  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.data.launched, true);
  assert.equal(firstResult.data.already_running, false);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.data.launched, false);
  assert.equal(secondResult.data.already_running, true);
  assert.equal(spawned.length, 1);
});

test('pickup-triggered popup relaunches the helper when one is already running', async () => {
  const sandbox = await makeSandbox('superplan-popup-relaunch-');

  await writeFile(path.join(sandbox.cwd, '.superplan', 'changes', 'demo', 'tasks', 'T-705.md'), `---
task_id: T-705
status: pending
priority: high
---

## Description
Show the popup again when a task is picked

## Acceptance Criteria
- [ ] First thing
`);

  const spawned = [];
  const terminated = [];
  const fakeSpawn = (command, args) => {
    const child = new EventEmitter();
    child.pid = 9876;
    child.unref = () => {};
    spawned.push({ command, args });
    return child;
  };

  await writeJson(path.join(sandbox.cwd, '.superplan', 'runtime', 'popup.json'), {
    pid: 4321,
    launched_at: '2026-03-20T10:00:00.000Z',
  });

  const { popup } = loadDistModule('cli/commands/popup.js');
  const result = await popup([], { json: true, quiet: true }, {
    platform: 'darwin',
    cwd: sandbox.cwd,
    spawnFn: fakeSpawn,
    nodeExecPath: '/usr/local/bin/node',
    cliEntryPath: '/tmp/superplan/dist/cli/main.js',
    isProcessAlive: pid => pid === 4321,
    relaunchIfRunning: true,
    terminateProcess: pid => {
      terminated.push(pid);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.launched, true);
  assert.equal(result.data.already_running, false);
  assert.deepEqual(terminated, [4321]);
  assert.equal(spawned.length, 1);
});

test('popup helper script keeps close and minimize window controls visible', async () => {
  const { buildMacOsPopupScript } = loadDistModule('cli/commands/popup.js');

  const script = buildMacOsPopupScript({
    cwd: '/tmp/workspace',
    nodeExecPath: '/usr/local/bin/node',
    cliEntryPath: '/tmp/superplan/dist/cli/main.js',
    initialSnapshot: {
      ok: true,
      data: {
        state: 'active',
        task_id: 'T-704',
        status: 'in_progress',
        description: 'Bring the popup to the front',
        progress_percent: 0,
        completed_acceptance_criteria: 0,
        total_acceptance_criteria: 1,
        ready_count: 0,
        blocked_count: 0,
        needs_feedback_count: 0,
      },
    },
  });

  assert.match(script, /NSApplicationActivationPolicyRegular/);
  assert.match(script, /NSWindow\.alloc\.initWithContentRectStyleMaskBackingDefer/);
  assert.doesNotMatch(script, /NSPanel\.alloc\.initWithContentRectStyleMaskBackingDefer/);
  assert.match(script, /while \(window\.isVisible\)/);
  assert.match(script, /NSWindowStyleMaskMiniaturizable/);
  assert.match(script, /standardWindowButton\(\$\.NSWindowCloseButton\)\.setHidden\(false\);/);
  assert.match(script, /standardWindowButton\(\$\.NSWindowMiniaturizeButton\)\.setHidden\(false\);/);
  assert.match(script, /window\.makeKeyAndOrderFront\(null\);/);
  assert.match(script, /activateIgnoringOtherApps\(true\);/);
  assert.match(script, /standardWindowButton\(\$\.NSWindowZoomButton\)\.setHidden\(true\);/);
  assert.doesNotMatch(script, /setFloatingPanel\(true\);/);
  assert.doesNotMatch(script, /while \(window\.isVisible\(\)\)/);
  assert.doesNotMatch(script, /standardWindowButton\(\$\.NSWindowMiniaturizeButton\)\.setHidden\(true\);/);
});
