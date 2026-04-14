const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  loadDistModule,
  parseCliJson,
  makeSandbox,
  readJson,
  runCli,
  writeChangeGraph,
  writeFile,
  writeJson,
  getSuperplanRoot,
} = require('./helpers.cjs');

test('macOS bundle launch plan reuses an already running matching workspace instance', () => {
  const { getMacosOverlayBundleLaunchPlan } = loadDistModule('cli/overlay-companion.js');

  const plan = getMacosOverlayBundleLaunchPlan({
    appBundlePath: '/Applications/Superplan Overlay Desktop.app',
    executablePath: '/Applications/Superplan Overlay Desktop.app/Contents/MacOS/superplan-overlay-desktop',
    workspacePath: '/tmp/workspace',
    runningProcessEntries: [
      { pid: 1234, command: '/Applications/Superplan Overlay Desktop.app/Contents/MacOS/superplan-overlay-desktop --workspace /tmp/workspace' },
    ],
  });

  assert.deepEqual(plan, {
    mode: 'reuse_running',
    command: null,
    args: [],
  });
});

test('macOS bundle launch plan reuses the existing app for another workspace', () => {
  const { getMacosOverlayBundleLaunchPlan } = loadDistModule('cli/overlay-companion.js');

  const executablePath = '/Applications/Superplan Overlay Desktop.app/Contents/MacOS/superplan-overlay-desktop';
  const plan = getMacosOverlayBundleLaunchPlan({
    appBundlePath: '/Applications/Superplan Overlay Desktop.app',
    executablePath,
    workspacePath: '/tmp/next-workspace',
    runningProcessEntries: [
      { pid: 1234, command: `${executablePath} --workspace /tmp/current-workspace` },
    ],
  });

  assert.deepEqual(plan, {
    mode: 'reuse_running',
    command: null,
    args: [],
  });
});

test('macOS bundle launch plan reuses the existing app when only the board-style process is already running', () => {
  const { getMacosOverlayBundleLaunchPlan } = loadDistModule('cli/overlay-companion.js');

  const executablePath = '/Applications/Superplan Overlay Desktop.app/Contents/MacOS/superplan-overlay-desktop';
  const plan = getMacosOverlayBundleLaunchPlan({
    appBundlePath: '/Applications/Superplan Overlay Desktop.app',
    executablePath,
    workspacePath: '/tmp/next-workspace',
    runningProcessEntries: [
      { pid: 1234, command: executablePath },
    ],
  });

  assert.deepEqual(plan, {
    mode: 'reuse_running',
    command: null,
    args: [],
  });
});

test('macOS bundle launch plan opens the app bundle without forcing a new instance on cold start', () => {
  const { getMacosOverlayBundleLaunchPlan } = loadDistModule('cli/overlay-companion.js');

  const plan = getMacosOverlayBundleLaunchPlan({
    appBundlePath: '/Applications/Superplan Overlay Desktop.app',
    executablePath: '/Applications/Superplan Overlay Desktop.app/Contents/MacOS/superplan-overlay-desktop',
    workspacePath: '/tmp/workspace',
    runningProcessEntries: [],
  });

  assert.deepEqual(plan, {
    mode: 'open_bundle',
    command: '/usr/bin/open',
    args: ['-a', '/Applications/Superplan Overlay Desktop.app', '--args', '--board', '--workspace', '/tmp/workspace'],
  });
  assert.equal(plan.args.includes('-n'), false);
});

test('overlay companion matches quoted Windows executable and workspace arguments', () => {
  const {
    commandMatchesExecutablePath,
    commandMatchesWorkspacePath,
    parseWindowsProcessEntriesPayload,
  } = loadDistModule('cli/overlay-companion.js');

  assert.equal(
    commandMatchesExecutablePath(
      '"C:\\Users\\me\\AppData\\Roaming\\superplan\\overlay\\superplan-overlay-desktop.exe" --workspace "C:\\repo with space"',
      'C:\\Users\\me\\AppData\\Roaming\\superplan\\overlay\\superplan-overlay-desktop.exe',
    ),
    true,
  );
  assert.equal(
    commandMatchesWorkspacePath(
      '"C:\\Users\\me\\AppData\\Roaming\\superplan\\overlay\\superplan-overlay-desktop.exe" --workspace "C:\\repo with space"',
      'C:\\repo with space',
    ),
    true,
  );
  assert.deepEqual(
    parseWindowsProcessEntriesPayload('[{"ProcessId":42,"CommandLine":"\\"C:\\\\\\\\overlay\\\\\\\\superplan-overlay-desktop.exe\\" --workspace \\"C:\\\\\\\\repo with space\\""}]'),
    [{
      pid: 42,
      command: '"C:\\\\overlay\\\\superplan-overlay-desktop.exe" --workspace "C:\\\\repo with space"',
    }],
  );
  assert.equal(
    commandMatchesExecutablePath(
      'Superplan --overlay --workspace /tmp/repo',
      '/Applications/Superplan.app/Contents/MacOS/Superplan',
    ),
    true,
  );
});

test('overlay process inspection degrades gracefully when spawning the system process list is blocked', async () => {
  const { readRunningProcessEntriesWithSpawn } = loadDistModule('cli/overlay-companion.js');

  const result = await readRunningProcessEntriesWithSpawn(() => {
    const error = new Error('spawn EPERM');
    error.code = 'EPERM';
    throw error;
  });

  assert.equal(result, null);
});

async function waitForFile(targetPath, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await fs.readFile(targetPath, 'utf-8');
    } catch {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  throw new Error(`Timed out waiting for ${targetPath}`);
}

function getOverlayRuntimePathsForSandbox(sandbox) {
  const { getWorkspaceOverlayKey } = loadDistModule('shared/overlay.js');
  const workspaceKey = getWorkspaceOverlayKey(sandbox.cwd);
  const runtimeDir = path.join(sandbox.home, '.config', 'superplan', workspaceKey, 'runtime');
  return {
    runtime_dir: runtimeDir,
    snapshot_path: path.join(runtimeDir, 'overlay.json'),
    control_path: path.join(runtimeDir, 'overlay-control.json'),
  };
}

function getGlobalRuntimePathsForSandbox(sandbox) {
  const runtimeDir = path.join(getSuperplanRoot(sandbox), 'runtime');
  return {
    runtime_dir: runtimeDir,
    tasks_path: path.join(runtimeDir, 'tasks.json'),
    events_path: path.join(runtimeDir, 'events.ndjson'),
    session_path: path.join(runtimeDir, 'session.json'),
  };
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && error.code === 'ESRCH') {
      return false;
    }

    throw error;
  }
}

async function waitForCondition(predicate, timeoutMs = 3000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for condition');
}

async function waitForPidCount(pidLogPath, expectedCount, timeoutMs = 8000) {
  let lastPids = [];

  await waitForCondition(async () => {
    try {
      const content = await fs.readFile(pidLogPath, 'utf-8');
      lastPids = content
        .split(/\r?\n/)
        .map(line => Number.parseInt(line.trim(), 10))
        .filter(Number.isInteger);
    } catch {
      lastPids = [];
    }

    return lastPids.length >= expectedCount;
  }, timeoutMs);

  return lastPids;
}

async function waitForProcessExit(pid, timeoutMs = 3000) {
  await waitForCondition(async () => !processExists(pid), timeoutMs);
}

async function writeDemoGraph(cwd, entries) {
  await writeChangeGraph(cwd, 'demo', {
    title: 'Demo',
    entries,
  });
}

async function enableOverlayForSandbox(sandbox) {
  await fs.mkdir(path.join(sandbox.cwd, '.superplan'), { recursive: true });
  return parseCliJson(await runCli(['overlay', 'enable', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
}

test('overlay --help explains overlay lifecycle subcommands', async () => {
  const result = await runCli(['overlay', '--help']);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Overlay commands:/);
  assert.match(result.stdout, /enable\s+\[--global\]/);
  assert.match(result.stdout, /disable\s+\[--global\]/);
  assert.match(result.stdout, /status\s+Show effective overlay preference/);
  assert.match(result.stdout, /ensure\s+Prepare overlay runtime state and launch or reveal the installed companion/);
  assert.match(result.stdout, /hide\s+Request the overlay companion to hide its window/);
  assert.doesNotMatch(result.stdout, /^\s*show\s+/m);
});

test('overlay ensure keeps the companion hidden until overlay support is enabled', async () => {
  const sandbox = await makeSandbox('superplan-overlay-ensure-');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-001', title: 'Primary task' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Primary task
Show the current task description in the overlay

## Acceptance Criteria
- [ ] A
`);

  const ensureResult = await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  const ensurePayload = parseCliJson(ensureResult);
  const realWorkspacePath = await fs.realpath(sandbox.cwd);

  assert.equal(ensureResult.code, 0);
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.requested_action, 'ensure');
  assert.equal(ensurePayload.data.applied_action, 'hide');
  assert.equal(ensurePayload.data.visible, false);
  assert.equal(ensurePayload.data.enabled, false);
  assert.equal(ensurePayload.data.reason, 'disabled');

  const snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(snapshot.project_name, path.basename(realWorkspacePath));
  assert.equal(snapshot.project_path, realWorkspacePath);
  assert.equal(typeof snapshot.project_id, 'string');
  assert.equal(snapshot.project_id.length, 10);
  assert.equal(snapshot.workspace_path, realWorkspacePath);
  assert.equal(snapshot.active_task, null);
  assert.deepEqual(snapshot.board.in_progress, []);
  assert.deepEqual(snapshot.board.backlog, [{
    task_id: 'T-001',
    change_id: 'demo',
    task_ref: 'demo/T-001',
    title: 'Primary task',
    description: 'Show the current task description in the overlay',
    status: 'backlog',
    completed_acceptance_criteria: 0,
    total_acceptance_criteria: 1,
    progress_percent: 0,
  }]);
  assert.equal(snapshot.attention_state, 'normal');
  assert.deepEqual(snapshot.events, []);

  const control = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);
  assert.deepEqual(control, {
    workspace_path: realWorkspacePath,
    requested_action: 'hide',
    updated_at: control.updated_at,
    visible: false,
  });
  assert.equal(typeof control.updated_at, 'string');
});

test('overlay enable turns on local overlay behavior and allows ensure to show the companion', async () => {
  const sandbox = await makeSandbox('superplan-overlay-enable-');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-010', title: 'Enable overlay' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-010.md'), `---
task_id: T-010
status: pending
priority: high
---

## Description
Enable overlay

## Acceptance Criteria
- [ ] A
`);

  const enablePayload = await enableOverlayForSandbox(sandbox);
  assert.equal(enablePayload.ok, true);
  assert.equal(enablePayload.data.enabled, true);
  assert.equal(enablePayload.data.local_enabled, true);

  const ensurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.requested_action, 'ensure');
  assert.equal(ensurePayload.data.applied_action, 'ensure');
  assert.equal(ensurePayload.data.visible, true);
  assert.equal(ensurePayload.data.enabled, true);
});

test('task scaffold new auto-launches the overlay companion when overlay is enabled', async () => {
  const sandbox = await makeSandbox('superplan-overlay-task-new-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-task-new.txt');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');

  await writeFile(fakeOverlayPath, `#!/bin/sh
printf '%s\n' "$*" > "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
printf '%s\n' "$SUPERPLAN_OVERLAY_WORKSPACE" >> "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
`);
  await fs.chmod(fakeOverlayPath, 0o755);
  await fs.mkdir(path.join(getSuperplanRoot(sandbox), 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'shape-spec', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  await writeChangeGraph(sandbox.cwd, 'shape-spec', {
    title: 'Shape Spec',
    entries: [
      { task_id: 'T-001', title: 'Break down the main spec graph' },
    ],
  });
  await enableOverlayForSandbox(sandbox);

  const createPayload = parseCliJson(await runCli([
    'task',
    'scaffold',
    'new',
    'shape-spec',
    '--task-id',
    'T-001',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
      SUPERPLAN_OVERLAY_TEST_OUTPUT: overlayOutputPath,
    },
  }));
  const realWorkspacePath = await fs.realpath(sandbox.cwd);
  const launchOutput = await waitForFile(overlayOutputPath);
  const snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  const control = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);

  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.data.task_id, 'shape-spec/T-001');
  assert.equal(createPayload.data.change_id, 'shape-spec');
  assert.equal(createPayload.data.overlay.requested_action, 'ensure');
  assert.equal(createPayload.data.overlay.enabled, true);
  assert.equal(createPayload.data.overlay.companion.launched, true);
  assert.equal(createPayload.data.overlay.companion.executable_path, fakeOverlayPath);
  assert.match(launchOutput, new RegExp(`--workspace ${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(control.requested_action, 'ensure');
  assert.equal(control.visible, true);
  assert.equal(snapshot.active_task, null);
  assert.equal(snapshot.board.backlog[0].task_id, 'T-001');
  assert.equal(snapshot.board.backlog[0].title, 'Break down the main spec graph');
});

test('task scaffold batch auto-launches the overlay companion when overlay is enabled', async () => {
  const sandbox = await makeSandbox('superplan-overlay-task-batch-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-task-batch.txt');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');

  await writeFile(fakeOverlayPath, `#!/bin/sh
printf '%s\n' "$*" > "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
printf '%s\n' "$SUPERPLAN_OVERLAY_WORKSPACE" >> "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
`);
  await fs.chmod(fakeOverlayPath, 0o755);
  await fs.mkdir(path.join(getSuperplanRoot(sandbox), 'changes'), { recursive: true });

  parseCliJson(await runCli(['change', 'new', 'shape-spec', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));
  await writeChangeGraph(sandbox.cwd, 'shape-spec', {
    title: 'Shape Spec',
    entries: [
      { task_id: 'T-001', title: 'Break down the main spec graph' },
      { task_id: 'T-002', title: 'Add implementation coverage' },
    ],
  });
  await enableOverlayForSandbox(sandbox);

  const createPayload = parseCliJson(await runCli([
    'task',
    'scaffold',
    'batch',
    'shape-spec',
    '--stdin',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
      SUPERPLAN_OVERLAY_TEST_OUTPUT: overlayOutputPath,
    },
    input: JSON.stringify([
      { task_id: 'T-001' },
      { task_id: 'T-002' },
    ]),
  }));
  const realWorkspacePath = await fs.realpath(sandbox.cwd);
  const launchOutput = await waitForFile(overlayOutputPath);
  const snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  const control = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);

  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.data.change_id, 'shape-spec');
  assert.equal(createPayload.data.created.length, 2);
  assert.equal(createPayload.data.overlay.requested_action, 'ensure');
  assert.equal(createPayload.data.overlay.enabled, true);
  assert.equal(createPayload.data.overlay.companion.launched, true);
  assert.equal(createPayload.data.overlay.companion.executable_path, fakeOverlayPath);
  assert.match(launchOutput, new RegExp(`--workspace ${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(control.requested_action, 'ensure');
  assert.equal(control.visible, true);
  assert.deepEqual(snapshot.board.backlog.map(task => task.task_id), ['T-001', 'T-002']);
  assert.deepEqual(snapshot.board.backlog.map(task => task.title), [
    'Break down the main spec graph',
    'Add implementation coverage',
  ]);
});

test('change new auto-launches the overlay and focuses the new change after prior work is done', async () => {
  const sandbox = await makeSandbox('superplan-overlay-change-new-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-change-new.txt');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');

  await writeFile(fakeOverlayPath, `#!/bin/sh
printf '%s\n' "$*" > "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
printf '%s\n' "$SUPERPLAN_OVERLAY_WORKSPACE" >> "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeChangeGraph(sandbox.cwd, 'finished-change', {
    title: 'Finished Change',
    entries: [
      { task_id: 'T-001', title: 'Ship prior work' },
    ],
  });
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'finished-change', 'tasks', 'T-001.md'), `---
task_id: T-001
status: pending
priority: high
---

## Description
Ship prior work

## Acceptance Criteria
- [x] Done
`);
  await writeJson(getGlobalRuntimePathsForSandbox(sandbox).tasks_path, {
    tasks: {
      'T-001': {
        status: 'done',
        started_at: '2026-03-23T10:00:00.000Z',
        completed_at: '2026-03-23T10:05:00.000Z',
        updated_at: '2026-03-23T10:05:00.000Z',
      },
    },
  });

  await enableOverlayForSandbox(sandbox);

  const changePayload = parseCliJson(await runCli([
    'change',
    'new',
    'next-change',
    '--title',
    'Next Change',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
      SUPERPLAN_OVERLAY_TEST_OUTPUT: overlayOutputPath,
    },
  }));
  const realWorkspacePath = await fs.realpath(sandbox.cwd);
  const launchOutput = await waitForFile(overlayOutputPath);
  const snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  const control = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);

  assert.equal(changePayload.ok, true);
  assert.equal(changePayload.data.change_id, 'next-change');
  assert.equal(changePayload.data.overlay.requested_action, 'ensure');
  assert.equal(changePayload.data.overlay.enabled, true);
  assert.equal(changePayload.data.overlay.companion.launched, true);
  assert.equal(changePayload.data.overlay.companion.executable_path, fakeOverlayPath);
  assert.match(launchOutput, new RegExp(`--workspace ${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(control.requested_action, 'ensure');
  assert.equal(control.visible, true);
  assert.equal(snapshot.attention_state, 'normal');
  assert.equal(snapshot.active_task, null);
  assert.deepEqual(snapshot.board.in_progress, []);
  assert.deepEqual(snapshot.board.backlog, []);
  assert.deepEqual(snapshot.board.blocked, []);
  assert.deepEqual(snapshot.board.needs_feedback, []);
  assert.equal(snapshot.board.done.length, 1);
  assert.equal(snapshot.board.done[0].task_id, 'T-001');
  assert.equal(snapshot.board.done[0].title, 'Ship prior work');
  assert.equal(snapshot.board.done[0].status, 'done');
  assert.equal(snapshot.board.done[0].completed_acceptance_criteria, 1);
  assert.equal(snapshot.board.done[0].total_acceptance_criteria, 1);
  assert.equal(snapshot.board.done[0].progress_percent, 100);
  assert.deepEqual(snapshot.focused_change, {
    change_id: 'next-change',
    title: 'Next Change',
    status: 'tracking',
    task_total: 0,
    task_done: 0,
    updated_at: snapshot.focused_change.updated_at,
  });
});

test('run with an explicit task id honors the global overlay setting when local workspace config is missing', async () => {
  const sandbox = await makeSandbox('superplan-overlay-global-fallback-');

  await writeFile(path.join(sandbox.home, '.config', 'superplan', 'config.toml'), `version = "0.1"

[overlay]
enabled = true
`);
  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-010A', title: 'Start with only global overlay config' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-010A.md'), `---
task_id: T-010A
status: pending
priority: high
---

## Description
Start with only global overlay config

## Acceptance Criteria
- [ ] A
`);

  const startPayload = parseCliJson(await runCli(['run', 'T-010A', '--json'], {
    cwd: sandbox.cwd,
    env: sandbox.env,
  }));

  assert.equal(startPayload.ok, true);
  assert.equal(startPayload.data.action, 'start');
  assert.equal(startPayload.data.status, 'in_progress');
  assert.equal(startPayload.data.overlay.requested_action, 'ensure');
  assert.equal(startPayload.data.overlay.enabled, true);
  assert.equal(startPayload.data.overlay.companion.launched, false);
  assert.equal(startPayload.data.overlay.companion.reason, 'not_installed');
});

test('run with an explicit task id re-ensures overlay visibility when continuing work', async () => {
  const sandbox = await makeSandbox('superplan-overlay-run-');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-150', title: 'Run overlay task' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-150.md'), `---
task_id: T-150
status: pending
priority: high
---

## Description
Run overlay task

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);
  const firstRunPayload = parseCliJson(await runCli(['run', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const startedSnapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  const startedControl = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);
  assert.equal(startedSnapshot.active_task?.task_id, 'T-150');
  assert.equal(startedSnapshot.active_task?.status, 'in_progress');
  assert.equal(startedControl.requested_action, 'ensure');
  assert.equal(startedControl.visible, true);
  assert.equal(firstRunPayload.data.overlay.requested_action, 'ensure');
  assert.equal(firstRunPayload.data.overlay.enabled, true);
  assert.equal(firstRunPayload.data.overlay.companion.launched, false);
  assert.equal(firstRunPayload.data.overlay.companion.reason, 'not_installed');

  parseCliJson(await runCli(['overlay', 'hide', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const hiddenControl = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);
  assert.equal(hiddenControl.requested_action, 'hide');
  assert.equal(hiddenControl.visible, false);

  const secondRunPayload = parseCliJson(await runCli(['run', 'T-150', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const continuedControl = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);
  assert.equal(continuedControl.requested_action, 'ensure');
  assert.equal(continuedControl.visible, true);
  assert.equal(secondRunPayload.data.overlay.requested_action, 'ensure');
  assert.equal(secondRunPayload.data.overlay.enabled, true);
  assert.equal(secondRunPayload.data.overlay.companion.launched, false);
  assert.equal(secondRunPayload.data.overlay.companion.reason, 'not_installed');
});

test('overlay ensure launches the installed companion with the explicit workspace path', async () => {
  const sandbox = await makeSandbox('superplan-overlay-launch-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-launch.txt');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');

  await writeFile(fakeOverlayPath, `#!/bin/sh
printf '%s\n' "$*" > "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
printf '%s\n' "$SUPERPLAN_OVERLAY_WORKSPACE" >> "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-011', title: 'Launch overlay companion' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-011.md'), `---
task_id: T-011
status: pending
priority: high
---

## Description
Launch overlay companion

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);

  const ensurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
      SUPERPLAN_OVERLAY_TEST_OUTPUT: overlayOutputPath,
    },
  }));
  const realWorkspacePath = await fs.realpath(sandbox.cwd);
  const launchOutput = await waitForFile(overlayOutputPath);

  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.applied_action, 'ensure');
  assert.equal(ensurePayload.data.companion.attempted, true);
  assert.equal(ensurePayload.data.companion.launched, true);
  assert.equal(ensurePayload.data.companion.executable_path, fakeOverlayPath);
  assert.match(launchOutput, new RegExp(`--workspace ${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(launchOutput, new RegExp(`${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
});

test('overlay ensure suppresses repeated launch attempts after a recent failure', async () => {
  const sandbox = await makeSandbox('superplan-overlay-launch-suppressed-');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay-noexec');

  await writeFile(fakeOverlayPath, '#!/bin/sh\nexit 0\n');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-011C', title: 'Suppress repeated overlay launch failures' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-011C.md'), `---
task_id: T-011C
status: pending
priority: high
---

## Description
Suppress repeated overlay launch failures

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);

  const overlayEnv = {
    ...sandbox.env,
    SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
  };

  const firstEnsurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));
  assert.equal(firstEnsurePayload.ok, true);
  assert.equal(firstEnsurePayload.data.companion.attempted, true);
  assert.equal(firstEnsurePayload.data.companion.launched, false);
  assert.equal(firstEnsurePayload.data.companion.reason, 'launch_failed');

  const secondEnsurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));
  assert.equal(secondEnsurePayload.ok, true);
  assert.equal(secondEnsurePayload.data.companion.attempted, false);
  assert.equal(secondEnsurePayload.data.companion.launched, false);
  assert.equal(secondEnsurePayload.data.companion.reason, 'launch_suppressed');
  assert.match(secondEnsurePayload.data.companion.message, /Recent overlay launch failure detected/);
});

test('overlay ensure does not launch a second detached companion when one is already running', async (t) => {
  const sandbox = await makeSandbox('superplan-overlay-single-instance-');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');
  const pidLogPath = path.join(sandbox.root, 'overlay-pids.txt');

  await writeFile(fakeOverlayPath, `#!/bin/sh
trap 'kill 0 >/dev/null 2>&1; exit 0' TERM INT
printf '%s\n' "$$" >> "$SUPERPLAN_OVERLAY_PID_LOG"
while :
do
  sleep 1 &
  wait $!
done
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-011B', title: 'Keep one overlay companion only' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-011B.md'), `---
task_id: T-011B
status: pending
priority: high
---

## Description
Keep one overlay companion only

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);

  const overlayEnv = {
    ...sandbox.env,
    SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
    SUPERPLAN_OVERLAY_PID_LOG: pidLogPath,
  };

  t.after(async () => {
    try {
      const content = await fs.readFile(pidLogPath, 'utf-8');
      const pids = content
        .split(/\r?\n/)
        .map(line => Number.parseInt(line.trim(), 10))
        .filter(Number.isInteger);

      for (const pid of pids) {
        if (processExists(pid)) {
          process.kill(pid, 'SIGTERM');
        }
      }
    } catch {}
  });

  parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  const [firstPid] = await waitForPidCount(pidLogPath, 1);
  assert.equal(processExists(firstPid), true);

  parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  await new Promise(resolve => setTimeout(resolve, 250));

  const allPids = (await fs.readFile(pidLogPath, 'utf-8'))
    .split(/\r?\n/)
    .map(line => Number.parseInt(line.trim(), 10))
    .filter(Number.isInteger);

  assert.deepEqual(allPids, [firstPid]);
});

test('overlay hide terminates the detached companion process', async (t) => {
  const sandbox = await makeSandbox('superplan-overlay-hide-terminates-');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');
  const pidLogPath = path.join(sandbox.root, 'overlay-pids.txt');

  await writeFile(fakeOverlayPath, `#!/bin/sh
trap 'kill 0 >/dev/null 2>&1; exit 0' TERM INT
printf '%s\n' "$$" >> "$SUPERPLAN_OVERLAY_PID_LOG"
while :
do
  sleep 1 &
  wait $!
done
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-011C', title: 'Terminate overlay companion on hide' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-011C.md'), `---
task_id: T-011C
status: pending
priority: high
---

## Description
Terminate overlay companion on hide

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);

  const overlayEnv = {
    ...sandbox.env,
    SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
    SUPERPLAN_OVERLAY_PID_LOG: pidLogPath,
  };

  t.after(async () => {
    try {
      const content = await fs.readFile(pidLogPath, 'utf-8');
      const pids = content
        .split(/\r?\n/)
        .map(line => Number.parseInt(line.trim(), 10))
        .filter(Number.isInteger);

      for (const pid of pids) {
        if (processExists(pid)) {
          process.kill(pid, 'SIGTERM');
        }
      }
    } catch {}
  });

  parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  const [pid] = await waitForPidCount(pidLogPath, 1);
  assert.equal(processExists(pid), true);

  parseCliJson(await runCli(['overlay', 'hide', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  await waitForProcessExit(pid);
});

test('task runtime request-feedback relaunches the companion after hide and restores overlay runtime state', async (t) => {
  const sandbox = await makeSandbox('superplan-overlay-feedback-relaunch-');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');
  const pidLogPath = path.join(sandbox.root, 'overlay-pids.txt');

  await writeFile(fakeOverlayPath, `#!/bin/sh
trap 'kill 0 >/dev/null 2>&1; exit 0' TERM INT
printf '%s\n' "$$" >> "$SUPERPLAN_OVERLAY_PID_LOG"
while :
do
  sleep 1 &
  wait $!
done
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeChangeGraph(sandbox.cwd, 'demo', {
    title: 'Demo',
    entries: [
      { task_id: 'T-011E', title: 'Request review after relaunch' },
    ],
  });

  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-011E.md'), `---
task_id: T-011E
status: pending
priority: high
---

## Description
Relaunch overlay when feedback is requested

## Acceptance Criteria
- [ ] A
`);

  await writeJson(getGlobalRuntimePathsForSandbox(sandbox).tasks_path, {
    tasks: {
      'demo/T-011E': {
        status: 'in_progress',
        started_at: '2026-03-23T10:00:00.000Z',
        updated_at: '2026-03-23T10:00:00.000Z',
      },
    },
  });

  await enableOverlayForSandbox(sandbox);

  const overlayEnv = {
    ...sandbox.env,
    SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
    SUPERPLAN_OVERLAY_PID_LOG: pidLogPath,
  };

  t.after(async () => {
    try {
      const content = await fs.readFile(pidLogPath, 'utf-8');
      const pids = content
        .split(/\r?\n/)
        .map(line => Number.parseInt(line.trim(), 10))
        .filter(Number.isInteger);

      for (const pid of pids) {
        if (processExists(pid)) {
          process.kill(pid, 'SIGTERM');
        }
      }
    } catch {}
  });

  const initialEnsurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));
  assert.equal(initialEnsurePayload.ok, true);
  assert.equal(initialEnsurePayload.data.applied_action, 'ensure');

  const [firstPid] = await waitForPidCount(pidLogPath, 1);
  assert.equal(processExists(firstPid), true);

  const initialSnapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(initialSnapshot.active_task?.task_id, 'T-011E');
  assert.equal(initialSnapshot.active_task?.status, 'in_progress');

  parseCliJson(await runCli(['overlay', 'hide', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  await waitForProcessExit(firstPid);

  const feedbackPayload = parseCliJson(await runCli([
    'task',
    'runtime',
    'request-feedback',
    'T-011E',
    '--message',
    'Please review',
    '--json',
  ], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  assert.equal(feedbackPayload.ok, true);
  assert.equal(feedbackPayload.data.status, 'needs_feedback');
  assert.equal(feedbackPayload.data.overlay.requested_action, 'ensure');
  assert.equal(feedbackPayload.data.overlay.applied_action, 'ensure');
  assert.equal(feedbackPayload.data.overlay.enabled, true);
  assert.equal(feedbackPayload.data.overlay.companion.launched, true);
  assert.equal(feedbackPayload.data.overlay.companion.executable_path, fakeOverlayPath);

  const [loggedFirstPid, secondPid] = await waitForPidCount(pidLogPath, 2);
  assert.equal(loggedFirstPid, firstPid);
  assert.notEqual(secondPid, firstPid);
  assert.equal(processExists(secondPid), true);

  const control = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);
  assert.equal(control.requested_action, 'ensure');
  assert.equal(control.visible, true);

  const snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(snapshot.active_task, null);
  assert.equal(snapshot.attention_state, 'needs_feedback');
  assert.equal(snapshot.board.needs_feedback[0].task_id, 'T-011E');
  assert.equal(snapshot.board.needs_feedback[0].message, 'Please review');
  assert.equal(snapshot.events.some(event => event.kind === 'needs_feedback'), true);
});

test('overlay ensure keeps the companion visible when a tracked change remains after task contracts are removed', async (t) => {
  const sandbox = await makeSandbox('superplan-overlay-empty-terminates-');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');
  const pidLogPath = path.join(sandbox.root, 'overlay-pids.txt');
  const taskPath = path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-011D.md');

  await writeFile(fakeOverlayPath, `#!/bin/sh
trap 'kill 0 >/dev/null 2>&1; exit 0' TERM INT
printf '%s\n' "$$" >> "$SUPERPLAN_OVERLAY_PID_LOG"
while :
do
  sleep 1 &
  wait $!
done
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-011D', title: 'Terminate overlay companion when there is nothing left to show' },
  ]);
  await writeFile(taskPath, `---
task_id: T-011D
status: pending
priority: high
---

## Description
Terminate overlay companion when there is nothing left to show

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);

  const overlayEnv = {
    ...sandbox.env,
    SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
    SUPERPLAN_OVERLAY_PID_LOG: pidLogPath,
  };

  t.after(async () => {
    try {
      const content = await fs.readFile(pidLogPath, 'utf-8');
      const pids = content
        .split(/\r?\n/)
        .map(line => Number.parseInt(line.trim(), 10))
        .filter(Number.isInteger);

      for (const pid of pids) {
        if (processExists(pid)) {
          process.kill(pid, 'SIGTERM');
        }
      }
    } catch {}
  });

  parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  const [pid] = await waitForPidCount(pidLogPath, 1);
  assert.equal(processExists(pid), true);

  await fs.rm(taskPath);

  const emptyEnsurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: overlayEnv,
  }));

  assert.equal(emptyEnsurePayload.ok, true);
  assert.equal(emptyEnsurePayload.data.applied_action, 'ensure');
  assert.equal(emptyEnsurePayload.data.has_content, true);
  assert.equal(emptyEnsurePayload.data.reason, undefined);

  const snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.deepEqual(snapshot.focused_change, {
    change_id: 'demo',
    title: 'Demo',
    status: 'tracking',
    task_total: 0,
    task_done: 0,
    updated_at: snapshot.focused_change.updated_at,
  });

  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(processExists(pid), true);
});

test('overlay status reports the last requested runtime visibility instead of recomputing it from content', async () => {
  const sandbox = await makeSandbox('superplan-overlay-status-');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-015', title: 'Overlay status task' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-015.md'), `---
task_id: T-015
status: pending
priority: high
---

## Description
Overlay status task

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);
  parseCliJson(await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  parseCliJson(await runCli(['overlay', 'hide', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const statusPayload = parseCliJson(await runCli(['overlay', 'status', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  assert.equal(statusPayload.ok, true);
  assert.equal(statusPayload.data.enabled, true);
  assert.equal(statusPayload.data.has_content, true);
  assert.equal(statusPayload.data.visible, false);
});

test('overlay ensure launches the macOS app bundle through open with the explicit workspace path', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('macOS-specific launcher behavior');
    return;
  }

  const sandbox = await makeSandbox('superplan-overlay-launch-app-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-launch-app.txt');
  const fakeAppPath = path.join(sandbox.root, 'Fake Overlay.app');
  const fakeExecutablePath = path.join(fakeAppPath, 'Contents', 'MacOS', 'fake-overlay');
  const infoPlistPath = path.join(fakeAppPath, 'Contents', 'Info.plist');

  await fs.mkdir(path.dirname(fakeExecutablePath), { recursive: true });
  await writeFile(fakeExecutablePath, `#!/bin/sh
printf '%s\n' "$*" > ${JSON.stringify(overlayOutputPath)}
`);
  await fs.chmod(fakeExecutablePath, 0o755);
  await writeFile(infoPlistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleExecutable</key>
    <string>fake-overlay</string>
    <key>CFBundleIdentifier</key>
    <string>com.superplan.test.fake-overlay</string>
    <key>CFBundleName</key>
    <string>Fake Overlay</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
  </dict>
</plist>
`);

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-011A', title: 'Launch overlay companion app bundle' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-011A.md'), `---
task_id: T-011A
status: pending
priority: high
---

## Description
Launch overlay companion app bundle

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);

  const ensurePayload = parseCliJson(await runCli(['overlay', 'ensure', '--json'], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_APP_PATH: fakeAppPath,
    },
  }));

  assert.equal(ensurePayload.ok, true);
  assert.equal(ensurePayload.data.applied_action, 'ensure');
  assert.equal(ensurePayload.data.companion.attempted, true);
  assert.equal(ensurePayload.data.companion.launched, true);
  assert.equal(ensurePayload.data.companion.install_path, fakeAppPath);
});

test('run with an explicit task id auto-launches the overlay companion when overlay is enabled', async () => {
  const sandbox = await makeSandbox('superplan-overlay-task-start-');
  const overlayOutputPath = path.join(sandbox.root, 'overlay-task-start.txt');
  const fakeOverlayPath = path.join(sandbox.root, 'fake-overlay');

  await writeFile(fakeOverlayPath, `#!/bin/sh
printf '%s\n' "$*" > "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
printf '%s\n' "$SUPERPLAN_OVERLAY_WORKSPACE" >> "$SUPERPLAN_OVERLAY_TEST_OUTPUT"
`);
  await fs.chmod(fakeOverlayPath, 0o755);

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-012', title: 'Auto-launch overlay on execution' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-012.md'), `---
task_id: T-012
status: pending
priority: high
---

## Description
Auto-launch overlay on execution

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);

  const startPayload = parseCliJson(await runCli(['run', 'T-012', '--json'], {
    cwd: sandbox.cwd,
    env: {
      ...sandbox.env,
      SUPERPLAN_OVERLAY_BINARY_PATH: fakeOverlayPath,
      SUPERPLAN_OVERLAY_TEST_OUTPUT: overlayOutputPath,
    },
  }));
  const realWorkspacePath = await fs.realpath(sandbox.cwd);
  const launchOutput = await waitForFile(overlayOutputPath);

  assert.equal(startPayload.ok, true);
  assert.equal(startPayload.data.action, 'start');
  assert.equal(startPayload.data.status, 'in_progress');
  assert.equal(startPayload.data.overlay.requested_action, 'ensure');
  assert.equal(startPayload.data.overlay.enabled, true);
  assert.equal(startPayload.data.overlay.companion.launched, true);
  assert.equal(startPayload.data.overlay.companion.executable_path, fakeOverlayPath);
  assert.match(launchOutput, new RegExp(`--workspace ${realWorkspacePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('run with an explicit task id ensures overlay visibility for both start and resume', async () => {
  const sandbox = await makeSandbox('superplan-overlay-pickup-');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-250', title: 'Pickup overlay task' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-250.md'), `---
task_id: T-250
status: pending
priority: high
---

## Description
Pickup overlay task

## Acceptance Criteria
- [ ] A
`);

  await enableOverlayForSandbox(sandbox);
  const startPayload = parseCliJson(await runCli(['run', 'T-250', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const startedControl = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);
  const startedSnapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(startedControl.requested_action, 'ensure');
  assert.equal(startedControl.visible, true);
  assert.equal(startedSnapshot.active_task?.task_id, 'T-250');
  assert.equal(startPayload.data.action, 'start');
  assert.equal(startPayload.data.overlay.requested_action, 'ensure');
  assert.equal(startPayload.data.overlay.enabled, true);
  assert.equal(startPayload.data.overlay.companion.launched, false);
  assert.equal(startPayload.data.overlay.companion.reason, 'not_installed');

  parseCliJson(await runCli(['overlay', 'hide', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  parseCliJson(await runCli(['task', 'runtime', 'block', 'T-250', '--reason', 'Need to pause', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));
  const resumePayload = parseCliJson(await runCli(['run', 'T-250', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const resumedControl = await readJson(getOverlayRuntimePathsForSandbox(sandbox).control_path);
  const resumedSnapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(resumedControl.requested_action, 'ensure');
  assert.equal(resumedControl.visible, true);
  assert.equal(resumedSnapshot.active_task?.task_id, 'T-250');
  assert.equal(resumedSnapshot.active_task?.status, 'in_progress');
  assert.equal(resumePayload.data.action, 'resume');
  assert.equal(resumePayload.data.reason, 'Task was resumed explicitly');
  assert.equal(resumePayload.data.overlay.requested_action, 'ensure');
  assert.equal(resumePayload.data.overlay.enabled, true);
  assert.equal(resumePayload.data.overlay.companion.launched, false);
  assert.equal(resumePayload.data.overlay.companion.reason, 'not_installed');
});

test('overlay snapshot includes active-task checklist progress counts', async () => {
  const sandbox = await makeSandbox('superplan-overlay-progress-');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-020', title: 'Track real checklist progress' },
  ]);
  await writeFile(path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-020.md'), `---
task_id: T-020
status: pending
priority: high
---

## Description
Track real checklist progress

## Acceptance Criteria
- [x] First
- [ ] Second
- [ ] Third
`);

  await enableOverlayForSandbox(sandbox);
  parseCliJson(await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  const snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(snapshot.active_task.task_id, 'T-020');
  assert.equal(snapshot.active_task.completed_acceptance_criteria, 1);
  assert.equal(snapshot.active_task.total_acceptance_criteria, 3);
  assert.equal(snapshot.active_task.progress_percent, 33);
  assert.deepEqual(snapshot.board.in_progress, [{
    task_id: 'T-020',
    change_id: 'demo',
    task_ref: 'demo/T-020',
    title: 'Track real checklist progress',
    status: 'in_progress',
    completed_acceptance_criteria: 1,
    total_acceptance_criteria: 3,
    progress_percent: 33,
  }]);
});

test('sync refreshes overlay snapshot after task checklist edits', async () => {
  const sandbox = await makeSandbox('superplan-overlay-sync-');
  const taskPath = path.join(getSuperplanRoot(sandbox), 'changes', 'demo', 'tasks', 'T-021.md');

  await writeDemoGraph(sandbox.cwd, [
    { task_id: 'T-021', title: 'Refresh overlay after checklist edits' },
  ]);
  await writeFile(taskPath, `---
task_id: T-021
status: pending
priority: high
---

## Description
Refresh overlay after checklist edits

## Acceptance Criteria
- [x] First
- [ ] Second
`);

  await enableOverlayForSandbox(sandbox);
  parseCliJson(await runCli(['overlay', 'ensure', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  let snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(snapshot.active_task.completed_acceptance_criteria, 1);
  assert.equal(snapshot.active_task.total_acceptance_criteria, 2);

  await writeFile(taskPath, `---
task_id: T-021
status: pending
priority: high
---

## Description
Refresh overlay after checklist edits

## Acceptance Criteria
- [x] First
- [x] Second
`);

  parseCliJson(await runCli(['sync', '--json'], { cwd: sandbox.cwd, env: sandbox.env }));

  snapshot = await readJson(getOverlayRuntimePathsForSandbox(sandbox).snapshot_path);
  assert.equal(snapshot.active_task, null);
  assert.equal(snapshot.attention_state, 'all_tasks_done');
  assert.deepEqual(snapshot.board.done, [{
    task_id: 'T-021',
    change_id: 'demo',
    task_ref: 'demo/T-021',
    title: 'Refresh overlay after checklist edits',
    status: 'done',
    completed_acceptance_criteria: 2,
    total_acceptance_criteria: 2,
    progress_percent: 100,
  }]);
});

test('task lifecycle updates overlay snapshot and emits high-signal alerts only', async () => {
  const feedbackSandbox = await makeSandbox('superplan-overlay-feedback-');

  await writeDemoGraph(feedbackSandbox.cwd, [
    { task_id: 'T-200', title: 'Needs review' },
  ]);
  await writeFile(path.join(getSuperplanRoot(feedbackSandbox), 'changes', 'demo', 'tasks', 'T-200.md'), `---
task_id: T-200
status: pending
priority: high
---

## Description
Needs review

## Acceptance Criteria
- [ ] A
`);

  parseCliJson(await runCli(['run', 'T-200', '--json'], { cwd: feedbackSandbox.cwd, env: feedbackSandbox.env }));
  parseCliJson(await runCli(['task', 'runtime', 'request-feedback', 'T-200', '--message', 'Please review', '--json'], { cwd: feedbackSandbox.cwd, env: feedbackSandbox.env }));

  const feedbackSnapshot = await readJson(getOverlayRuntimePathsForSandbox(feedbackSandbox).snapshot_path);
  assert.equal(feedbackSnapshot.active_task, null);
  assert.equal(feedbackSnapshot.attention_state, 'needs_feedback');
  assert.deepEqual(feedbackSnapshot.board.needs_feedback, [{
    task_id: 'T-200',
    change_id: 'demo',
    task_ref: 'demo/T-200',
    title: 'Needs review',
    status: 'needs_feedback',
    completed_acceptance_criteria: 0,
    total_acceptance_criteria: 1,
    progress_percent: 0,
    started_at: feedbackSnapshot.board.needs_feedback[0].started_at,
    updated_at: feedbackSnapshot.board.needs_feedback[0].updated_at,
    message: 'Please review',
  }]);
  assert.equal(typeof feedbackSnapshot.board.needs_feedback[0].started_at, 'string');
  assert.equal(typeof feedbackSnapshot.board.needs_feedback[0].updated_at, 'string');
  assert.equal(feedbackSnapshot.events.length, 1);
  assert.equal(feedbackSnapshot.events[0].kind, 'needs_feedback');

  const doneSandbox = await makeSandbox('superplan-overlay-done-');

  await writeDemoGraph(doneSandbox.cwd, [
    { task_id: 'T-300', title: 'Finish me' },
  ]);
  await writeFile(path.join(getSuperplanRoot(doneSandbox), 'changes', 'demo', 'tasks', 'T-300.md'), `---
task_id: T-300
status: pending
priority: high
---

## Description
Finish me

## Acceptance Criteria
- [x] A
`);

  await writeJson(getGlobalRuntimePathsForSandbox(doneSandbox).tasks_path, {
    tasks: {
      'demo/T-300': {
        status: 'in_progress',
        started_at: '2026-03-19T12:00:00.000Z',
        updated_at: '2026-03-19T12:00:00.000Z',
      },
    },
  });

  const reviewPayload = parseCliJson(await runCli(['task', 'review', 'complete', 'demo/T-300', '--json'], { cwd: doneSandbox.cwd, env: doneSandbox.env }));
  assert.equal(reviewPayload.data.status, 'done');

  const doneSnapshot = await readJson(getOverlayRuntimePathsForSandbox(doneSandbox).snapshot_path);
  assert.equal(doneSnapshot.attention_state, 'all_tasks_done');
  assert.deepEqual(doneSnapshot.board.done, [{
    task_id: 'T-300',
    change_id: 'demo',
    task_ref: 'demo/T-300',
    title: 'Finish me',
    status: 'done',
    completed_acceptance_criteria: 1,
    total_acceptance_criteria: 1,
    progress_percent: 100,
    started_at: '2026-03-19T12:00:00.000Z',
    completed_at: doneSnapshot.board.done[0].completed_at,
    updated_at: doneSnapshot.board.done[0].updated_at,
  }]);
  assert.equal(typeof doneSnapshot.board.done[0].completed_at, 'string');
  assert.equal(typeof doneSnapshot.board.done[0].updated_at, 'string');
  assert.equal(doneSnapshot.events.length, 1);
  assert.equal(doneSnapshot.events[0].kind, 'all_tasks_done');
});
