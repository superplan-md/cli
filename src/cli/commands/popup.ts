import { spawn } from 'child_process';
import * as path from 'path';
import { status } from './status';
import { task } from './task';

interface PopupCommandOptions {
  json: boolean;
  quiet: boolean;
}

interface PopupDeps {
  platform: string;
  cwd: string;
  nodeExecPath: string;
  cliEntryPath: string;
  spawnFn: typeof spawn;
}

type PopupSnapshotResult =
  | {
      ok: true;
      data: {
        state: 'active' | 'next_ready' | 'idle';
        task_id: string | null;
        status: string;
        description: string;
        progress_percent: number | null;
        completed_acceptance_criteria: number | null;
        total_acceptance_criteria: number | null;
        ready_count: number;
        blocked_count: number;
        needs_feedback_count: number;
      };
    }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    };

export type PopupResult =
  | {
      ok: true;
      data: {
        launched: true;
        platform: 'darwin';
        state: 'active' | 'next_ready' | 'idle';
        task_id: string | null;
      };
    }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean };
    };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

export async function getPopupSnapshot(): Promise<PopupSnapshotResult> {
  const statusResult = await status();
  if (!statusResult.ok) {
    return statusResult;
  }

  const targetTaskId = statusResult.data.active ?? statusResult.data.ready[0] ?? null;
  const state = statusResult.data.active
    ? 'active'
    : targetTaskId
      ? 'next_ready'
      : 'idle';

  if (!targetTaskId) {
    return {
      ok: true,
      data: {
        state,
        task_id: null,
        status: 'idle',
        description: 'No active or ready task right now.',
        progress_percent: null,
        completed_acceptance_criteria: null,
        total_acceptance_criteria: null,
        ready_count: statusResult.data.ready.length,
        blocked_count: statusResult.data.blocked.length,
        needs_feedback_count: statusResult.data.needs_feedback.length,
      },
    };
  }

  const taskResult = await task(['show', targetTaskId]);
  if (!taskResult.ok) {
    return taskResult;
  }

  if (!('task' in taskResult.data) || !taskResult.data.task) {
    return {
      ok: false,
      error: {
        code: 'POPUP_TASK_LOOKUP_FAILED',
        message: 'Unable to resolve task details for popup',
        retryable: true,
      },
    };
  }

  const taskData = taskResult.data.task;

  return {
    ok: true,
    data: {
      state,
      task_id: targetTaskId,
      status: taskData.status,
      description: taskData.description,
      progress_percent: taskData.progress_percent,
      completed_acceptance_criteria: taskData.completed_acceptance_criteria,
      total_acceptance_criteria: taskData.total_acceptance_criteria,
      ready_count: statusResult.data.ready.length,
      blocked_count: statusResult.data.blocked.length,
      needs_feedback_count: statusResult.data.needs_feedback.length,
    },
  };
}

export function buildMacOsPopupScript(options: {
  cwd: string;
  nodeExecPath: string;
  cliEntryPath: string;
  initialSnapshot: PopupSnapshotResult & { ok: true };
}): string {
  const { cwd, nodeExecPath, cliEntryPath, initialSnapshot } = options;
  const statusCommand = `cd ${shellQuote(cwd)} && ${shellQuote(nodeExecPath)} ${shellQuote(cliEntryPath)} status --json`;
  const taskShowPrefix = `cd ${shellQuote(cwd)} && ${shellQuote(nodeExecPath)} ${shellQuote(cliEntryPath)} task show `;
  const taskShowSuffix = ' --json';

  return `
ObjC.import('AppKit');
ObjC.import('Foundation');

const app = Application.currentApplication();
app.includeStandardAdditions = true;

const nsApp = $.NSApplication.sharedApplication;
nsApp.setActivationPolicy($.NSApplicationActivationPolicyAccessory);

const INITIAL_SNAPSHOT = ${JSON.stringify(initialSnapshot.data)};
const STATUS_COMMAND = ${JSON.stringify(statusCommand)};
const TASK_SHOW_COMMAND_PREFIX = ${JSON.stringify(taskShowPrefix)};
const TASK_SHOW_COMMAND_SUFFIX = ${JSON.stringify(taskShowSuffix)};

function shell(command) {
  try {
    return app.doShellScript(command);
  } catch (error) {
    return '';
  }
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\"'\\"'") + "'";
}

function makeIdleSnapshot(statusData) {
  return {
    state: 'idle',
    task_id: null,
    status: 'idle',
    description: 'No active or ready task right now.',
    progress_percent: null,
    completed_acceptance_criteria: null,
    total_acceptance_criteria: null,
    ready_count: statusData.ready.length,
    blocked_count: statusData.blocked.length,
    needs_feedback_count: statusData.needs_feedback.length,
  };
}

function readSnapshot() {
  try {
    const statusPayload = JSON.parse(shell(STATUS_COMMAND));
    if (!statusPayload.ok || !statusPayload.data) {
      return {
        state: 'idle',
        task_id: null,
        status: 'error',
        description: 'Unable to read Superplan status.',
        progress_percent: null,
        completed_acceptance_criteria: null,
        total_acceptance_criteria: null,
        ready_count: 0,
        blocked_count: 0,
        needs_feedback_count: 0,
      };
    }

    const statusData = statusPayload.data;
    const taskId = statusData.active || (statusData.ready.length > 0 ? statusData.ready[0] : null);

    if (!taskId) {
      return makeIdleSnapshot(statusData);
    }

    const taskPayload = JSON.parse(shell(
      TASK_SHOW_COMMAND_PREFIX + shellQuote(taskId) + TASK_SHOW_COMMAND_SUFFIX
    ));

    if (!taskPayload.ok || !taskPayload.data || !taskPayload.data.task) {
      return makeIdleSnapshot(statusData);
    }

    const taskData = taskPayload.data.task;

    return {
      state: statusData.active ? 'active' : 'next_ready',
      task_id: taskId,
      status: taskData.status,
      description: taskData.description || '',
      progress_percent: typeof taskData.progress_percent === 'number' ? taskData.progress_percent : null,
      completed_acceptance_criteria: typeof taskData.completed_acceptance_criteria === 'number'
        ? taskData.completed_acceptance_criteria
        : null,
      total_acceptance_criteria: typeof taskData.total_acceptance_criteria === 'number'
        ? taskData.total_acceptance_criteria
        : null,
      ready_count: statusData.ready.length,
      blocked_count: statusData.blocked.length,
      needs_feedback_count: statusData.needs_feedback.length,
    };
  } catch (error) {
    return {
      state: 'idle',
      task_id: null,
      status: 'error',
      description: 'Unable to refresh popup state.',
      progress_percent: null,
      completed_acceptance_criteria: null,
      total_acceptance_criteria: null,
      ready_count: 0,
      blocked_count: 0,
      needs_feedback_count: 0,
    };
  }
}

function stateHeadline(snapshot) {
  if (snapshot.state === 'active' && snapshot.task_id) {
    return 'Working on ' + snapshot.task_id;
  }

  if (snapshot.state === 'next_ready' && snapshot.task_id) {
    return 'Up next: ' + snapshot.task_id;
  }

  return 'No active task';
}

function stateMeta(snapshot) {
  const progressText = snapshot.progress_percent === null
    ? 'No progress yet'
    : 'Progress ' + snapshot.progress_percent + '%';

  const acceptanceText = snapshot.completed_acceptance_criteria === null || snapshot.total_acceptance_criteria === null
    ? ''
    : '  AC ' + snapshot.completed_acceptance_criteria + '/' + snapshot.total_acceptance_criteria;

  return [
    'Status ' + String(snapshot.status).replaceAll('_', ' '),
    progressText + acceptanceText,
    'Ready ' + snapshot.ready_count,
    'Blocked ' + snapshot.blocked_count,
    'Feedback ' + snapshot.needs_feedback_count,
  ].join('  |  ');
}

function makeLabel(frame, fontSize, weight, color) {
  const label = $.NSTextField.labelWithString('');
  label.setFrame(frame);
  label.setDrawsBackground(false);
  label.setBezeled(false);
  label.setEditable(false);
  label.setSelectable(false);
  label.setLineBreakMode($.NSLineBreakByWordWrapping);
  label.setUsesSingleLineMode(false);
  label.setTextColor(color);

  if (weight) {
    label.setFont($.NSFont.systemFontOfSizeWeight(fontSize, weight));
  } else {
    label.setFont($.NSFont.systemFontOfSize(fontSize));
  }

  return label;
}

const visibleFrame = $.NSScreen.mainScreen.visibleFrame;
const popupWidth = 380;
const popupHeight = 190;
const popupX = visibleFrame.origin.x + visibleFrame.size.width - popupWidth - 20;
const popupY = visibleFrame.origin.y + visibleFrame.size.height - popupHeight - 20;

const styleMask = $.NSWindowStyleMaskTitled | $.NSWindowStyleMaskClosable;
const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(
  $.NSMakeRect(popupX, popupY, popupWidth, popupHeight),
  styleMask,
  $.NSBackingStoreBuffered,
  false
);

panel.setTitle('Superplan');
panel.setFloatingPanel(true);
panel.setLevel($.NSFloatingWindowLevel);
panel.setHidesOnDeactivate(false);
panel.setCollectionBehavior($.NSWindowCollectionBehaviorCanJoinAllSpaces);
panel.setReleasedWhenClosed(false);
panel.standardWindowButton($.NSWindowMiniaturizeButton).setHidden(true);
panel.standardWindowButton($.NSWindowZoomButton).setHidden(true);

const contentView = panel.contentView;
const backgroundView = $.NSView.alloc.initWithFrame($.NSMakeRect(0, 0, popupWidth, popupHeight));
backgroundView.setWantsLayer(true);
backgroundView.layer.setBackgroundColor($.NSColor.windowBackgroundColor.CGColor);
contentView.addSubview(backgroundView);

const eyebrowLabel = makeLabel($.NSMakeRect(20, 150, 340, 18), 11, $.NSFontWeightMedium, $.NSColor.secondaryLabelColor);
eyebrowLabel.setStringValue('SUPERPLAN');
backgroundView.addSubview(eyebrowLabel);

const titleLabel = makeLabel($.NSMakeRect(20, 112, 340, 32), 22, $.NSFontWeightSemibold, $.NSColor.labelColor);
backgroundView.addSubview(titleLabel);

const descriptionLabel = makeLabel($.NSMakeRect(20, 58, 340, 46), 13, null, $.NSColor.labelColor);
backgroundView.addSubview(descriptionLabel);

const metaLabel = makeLabel($.NSMakeRect(20, 24, 340, 28), 11, null, $.NSColor.secondaryLabelColor);
backgroundView.addSubview(metaLabel);

function refreshUI(snapshot) {
  titleLabel.setStringValue(stateHeadline(snapshot));
  descriptionLabel.setStringValue(snapshot.description || 'No description available.');
  metaLabel.setStringValue(stateMeta(snapshot));
}

refreshUI(INITIAL_SNAPSHOT);

const timer = $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(
  2.0,
  true,
  ObjC.block('void, id', function() {
    refreshUI(readSnapshot());
  })
);

$.NSRunLoop.currentRunLoop.addTimerForMode(timer, $.NSRunLoopCommonModes);
panel.makeKeyAndOrderFront(null);

while (panel.isVisible()) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2));
}

timer.invalidate();
`;
}

export async function popup(
  _args: string[],
  _options: PopupCommandOptions,
  deps: Partial<PopupDeps> = {},
): Promise<PopupResult> {
  const runtimeDeps: PopupDeps = {
    platform: process.platform,
    cwd: process.cwd(),
    nodeExecPath: process.execPath,
    cliEntryPath: process.argv[1] ?? path.join(process.cwd(), 'dist', 'cli', 'main.js'),
    spawnFn: spawn,
    ...deps,
  };

  if (runtimeDeps.platform !== 'darwin') {
    return {
      ok: false,
      error: {
        code: 'PLATFORM_UNSUPPORTED',
        message: 'The popup MVP currently supports macOS only',
        retryable: false,
      },
    };
  }

  const popupSnapshot = await getPopupSnapshot();
  if (!popupSnapshot.ok) {
    return popupSnapshot;
  }

  const popupScript = buildMacOsPopupScript({
    cwd: runtimeDeps.cwd,
    nodeExecPath: runtimeDeps.nodeExecPath,
    cliEntryPath: runtimeDeps.cliEntryPath,
    initialSnapshot: popupSnapshot,
  });

  const child = runtimeDeps.spawnFn('osascript', ['-l', 'JavaScript', '-e', popupScript], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  return {
    ok: true,
    data: {
      launched: true,
      platform: 'darwin',
      state: popupSnapshot.data.state,
      task_id: popupSnapshot.data.task_id,
    },
  };
}
