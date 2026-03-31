import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { type ExecutionRootKind } from './execution-roots';
import { resolveProjectIdentity, resolveWorkspaceRoot } from './project-identity';
import { withProjectStateLock } from './state-lock';
import { readJsonFile, writeJsonAtomic } from './state-store';
import { resolveSuperplanRoot } from './workspace-root';
import { collectWorktreeSnapshot, type WorktreeSnapshot } from './worktree-snapshot';

export interface SessionWorktreeBaseline {
  task_ref: string | null;
  snapshot: WorktreeSnapshot;
}

export interface SessionFocusEntry {
  session_id: string;
  focused_change_id: string | null;
  focused_task_ref: string | null;
  attached_change_id: string | null;
  execution_root_id: string | null;
  execution_root_path: string | null;
  execution_root_kind: ExecutionRootKind | null;
  worktree_baseline: SessionWorktreeBaseline | null;
  updated_at: string;
}

interface SessionFocusState {
  sessions: Record<string, SessionFocusEntry>;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function getSessionFocusPath(startDir = process.cwd()): string {
  return path.join(resolveSuperplanRoot(startDir), 'runtime', 'session-focus.json');
}

function createEmptySessionFocusState(): SessionFocusState {
  return {
    sessions: {},
  };
}

function isSessionFocusEntry(value: unknown): value is SessionFocusEntry {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as SessionFocusEntry).session_id === 'string'
    && typeof (value as SessionFocusEntry).updated_at === 'string',
  );
}

function normalizeSessionFocusEntry(value: unknown): SessionFocusEntry | null {
  if (!isSessionFocusEntry(value)) {
    return null;
  }

  return {
    session_id: value.session_id,
    focused_change_id: normalizeOptionalString(value.focused_change_id),
    focused_task_ref: normalizeOptionalString(value.focused_task_ref),
    attached_change_id: normalizeOptionalString((value as SessionFocusEntry).attached_change_id),
    execution_root_id: normalizeOptionalString((value as SessionFocusEntry).execution_root_id),
    execution_root_path: normalizeOptionalString((value as SessionFocusEntry).execution_root_path),
    execution_root_kind: (value as SessionFocusEntry).execution_root_kind === 'primary' || (value as SessionFocusEntry).execution_root_kind === 'worktree'
      ? (value as SessionFocusEntry).execution_root_kind
      : null,
    worktree_baseline: normalizeSessionWorktreeBaseline((value as SessionFocusEntry).worktree_baseline),
    updated_at: value.updated_at,
  };
}

function isWorktreeSnapshot(value: unknown): value is WorktreeSnapshot {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as WorktreeSnapshot).workspace_root === 'string'
    && typeof (value as WorktreeSnapshot).captured_at === 'string'
    && typeof (value as WorktreeSnapshot).files === 'object'
    && (value as WorktreeSnapshot).files !== null,
  );
}

function normalizeWorktreeSnapshot(value: unknown): WorktreeSnapshot | null {
  if (!isWorktreeSnapshot(value)) {
    return null;
  }

  const files = value.files && typeof value.files === 'object'
    ? Object.fromEntries(
      Object.entries(value.files)
        .filter((entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string'),
    )
    : {};

  return {
    workspace_root: value.workspace_root,
    captured_at: value.captured_at,
    files,
  };
}

function normalizeSessionWorktreeBaseline(value: unknown): SessionWorktreeBaseline | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = normalizeWorktreeSnapshot((value as SessionWorktreeBaseline).snapshot);
  if (!snapshot) {
    return null;
  }

  return {
    task_ref: normalizeOptionalString((value as SessionWorktreeBaseline).task_ref),
    snapshot,
  };
}

function getChangeIdFromTaskRef(taskRef: string | null): string | null {
  if (!taskRef) {
    return null;
  }

  const separatorIndex = taskRef.indexOf('/');
  if (separatorIndex <= 0) {
    return null;
  }

  return taskRef.slice(0, separatorIndex);
}

export function getSuperplanSessionId(): string | null {
  return normalizeOptionalString(process.env.SUPERPLAN_SESSION_ID);
}

async function readSessionFocusState(startDir = process.cwd()): Promise<SessionFocusState> {
  const parsed = await readJsonFile<Partial<SessionFocusState>>(getSessionFocusPath(startDir), createEmptySessionFocusState());
  const sessions = parsed.sessions && typeof parsed.sessions === 'object'
    ? parsed.sessions
    : {};

  return {
    sessions: Object.fromEntries(
      Object.entries(sessions)
        .map(([sessionId, value]) => [sessionId, normalizeSessionFocusEntry(value)])
        .filter((entry): entry is [string, SessionFocusEntry] => entry[1] !== null),
    ),
  };
}

async function writeSessionFocusState(state: SessionFocusState, startDir = process.cwd()): Promise<void> {
  const focusPath = getSessionFocusPath(startDir);
  await fs.mkdir(path.dirname(focusPath), { recursive: true });
  await writeJsonAtomic(focusPath, state);
}

function getExecutionRootKind(): ExecutionRootKind {
  const identity = resolveProjectIdentity();
  if (!identity.git_common_dir) {
    return 'primary';
  }

  const primaryCheckout = path.basename(identity.git_common_dir) === '.git'
    ? path.dirname(identity.git_common_dir)
    : identity.workspace_root;

  return resolveWorkspaceRoot() === primaryCheckout ? 'primary' : 'worktree';
}

function getExecutionRootKindForPath(executionRootPath: string | null): ExecutionRootKind | null {
  if (!executionRootPath) {
    return null;
  }

  const identity = resolveProjectIdentity(executionRootPath);
  if (!identity.git_common_dir) {
    return 'primary';
  }

  const primaryCheckout = path.basename(identity.git_common_dir) === '.git'
    ? path.dirname(identity.git_common_dir)
    : identity.workspace_root;

  return resolveWorkspaceRoot(executionRootPath) === primaryCheckout ? 'primary' : 'worktree';
}

function getExecutionRootId(executionRootPath: string | null): string | null {
  if (!executionRootPath) {
    return null;
  }

  return createHash('sha1').update(executionRootPath).digest('hex').slice(0, 12);
}

export async function readSessionFocus(sessionId = getSuperplanSessionId(), startDir = process.cwd()): Promise<SessionFocusEntry | null> {
  if (!sessionId) {
    return null;
  }

  const state = await readSessionFocusState(startDir);
  return state.sessions[sessionId] ?? null;
}

async function setSessionFocusInternal(options: {
  sessionId?: string | null;
  focusedChangeId?: string | null;
  focusedTaskRef?: string | null;
  captureWorktreeBaseline?: boolean;
  attachedChangeId?: string | null;
  executionRootPath?: string | null;
  executionRootKind?: ExecutionRootKind | null;
  startDir?: string;
}): Promise<SessionFocusEntry | null> {
  const sessionId = options.sessionId ?? getSuperplanSessionId();
  if (!sessionId) {
    return null;
  }

  const startDir = options.startDir ?? options.executionRootPath ?? process.cwd();
  const state = await readSessionFocusState(startDir);
  const existing = state.sessions[sessionId];
  const focusedTaskRef = options.focusedTaskRef === undefined
    ? existing?.focused_task_ref ?? null
    : normalizeOptionalString(options.focusedTaskRef);
  const focusedChangeId = options.focusedChangeId === undefined
    ? normalizeOptionalString(existing?.focused_change_id ?? getChangeIdFromTaskRef(focusedTaskRef))
    : normalizeOptionalString(options.focusedChangeId) ?? getChangeIdFromTaskRef(focusedTaskRef);
  const shouldCaptureWorktreeBaseline = options.captureWorktreeBaseline === true;
  const executionRootPath = options.executionRootPath === undefined
    ? existing?.execution_root_path ?? resolveWorkspaceRoot(startDir)
    : normalizeOptionalString(options.executionRootPath) ?? resolveWorkspaceRoot(startDir);
  const nextWorktreeBaseline = shouldCaptureWorktreeBaseline && focusedTaskRef
    ? {
      task_ref: focusedTaskRef,
      snapshot: await collectWorktreeSnapshot(executionRootPath),
    }
    : (
      existing?.worktree_baseline && existing.worktree_baseline.task_ref === focusedTaskRef
        ? existing.worktree_baseline
        : null
    );
  const executionRootId = getExecutionRootId(executionRootPath);
  const executionRootKind = options.executionRootKind == null
    ? existing?.execution_root_kind ?? getExecutionRootKindForPath(executionRootPath) ?? getExecutionRootKind()
    : options.executionRootKind;
  const attachedChangeId = options.attachedChangeId === undefined
    ? normalizeOptionalString(existing?.attached_change_id ?? focusedChangeId)
    : normalizeOptionalString(options.attachedChangeId) ?? focusedChangeId;
  const nextEntry: SessionFocusEntry = {
    session_id: sessionId,
    focused_change_id: focusedChangeId,
    focused_task_ref: focusedTaskRef,
    attached_change_id: attachedChangeId,
    execution_root_id: executionRootId,
    execution_root_path: executionRootPath,
    execution_root_kind: executionRootKind,
    worktree_baseline: nextWorktreeBaseline,
    updated_at: new Date().toISOString(),
  };

  state.sessions[sessionId] = nextEntry;
  await writeSessionFocusState(state, startDir);
  return nextEntry;
}

export async function setSessionFocus(options: {
  sessionId?: string | null;
  focusedChangeId?: string | null;
  focusedTaskRef?: string | null;
  captureWorktreeBaseline?: boolean;
  attachedChangeId?: string | null;
  executionRootPath?: string | null;
  executionRootKind?: ExecutionRootKind | null;
  startDir?: string;
}): Promise<SessionFocusEntry | null> {
  const sessionId = options.sessionId ?? getSuperplanSessionId();
  if (!sessionId) {
    return null;
  }

  const startDir = options.startDir ?? options.executionRootPath ?? process.cwd();
  return await withProjectStateLock(() => setSessionFocusInternal({ ...options, sessionId, startDir }), startDir);
}

export async function setSessionFocusUnlocked(options: {
  sessionId?: string | null;
  focusedChangeId?: string | null;
  focusedTaskRef?: string | null;
  captureWorktreeBaseline?: boolean;
  attachedChangeId?: string | null;
  executionRootPath?: string | null;
  executionRootKind?: ExecutionRootKind | null;
  startDir?: string;
}): Promise<SessionFocusEntry | null> {
  return await setSessionFocusInternal(options);
}

export async function clearSessionFocus(sessionId = getSuperplanSessionId()): Promise<void> {
  if (!sessionId) {
    return;
  }

  await withProjectStateLock(async () => {
    const state = await readSessionFocusState();
    if (!(sessionId in state.sessions)) {
      return;
    }

    delete state.sessions[sessionId];
    await writeSessionFocusState(state);
  });
}

export async function clearSessionFocusForChange(changeId: string): Promise<void> {
  await withProjectStateLock(async () => {
    const state = await readSessionFocusState();
    let changed = false;

    for (const [sessionId, session] of Object.entries(state.sessions)) {
      const focusedTaskChangeId = getChangeIdFromTaskRef(session.focused_task_ref);
      if (session.focused_change_id !== changeId && focusedTaskChangeId !== changeId && session.attached_change_id !== changeId) {
        continue;
      }

      state.sessions[sessionId] = {
        ...session,
        focused_change_id: null,
        focused_task_ref: null,
        attached_change_id: null,
        worktree_baseline: null,
        updated_at: new Date().toISOString(),
      };
      changed = true;
    }

    if (changed) {
      await writeSessionFocusState(state);
    }
  });
}
