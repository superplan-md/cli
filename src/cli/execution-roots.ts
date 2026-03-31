import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolveProjectIdentity, resolveWorkspaceRoot } from './project-identity';
import { getSuperplanSessionId } from './session-focus';
import { withProjectStateLock } from './state-lock';
import { readJsonFile, writeJsonAtomic } from './state-store';
import { resolveSuperplanRoot } from './workspace-root';

export type ExecutionRootKind = 'primary' | 'worktree';
export type ExecutionRootStatus = 'attached' | 'detached' | 'missing' | 'stale';

export interface ExecutionRootRecord {
  root_id: string;
  path: string;
  kind: ExecutionRootKind;
  branch: string | null;
  head: string | null;
  attached_change_id: string | null;
  owner_session_id: string | null;
  created_at: string;
  updated_at: string;
  status: ExecutionRootStatus;
}

export interface ExecutionRootsState {
  version: 1;
  roots: Record<string, ExecutionRootRecord>;
}

function createEmptyExecutionRootsState(): ExecutionRootsState {
  return {
    version: 1,
    roots: {},
  };
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function getRecordTimestamp(record: ExecutionRootRecord): number {
  const timestamp = Date.parse(record.updated_at || record.created_at);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortExecutionRootsByFreshness(left: ExecutionRootRecord, right: ExecutionRootRecord): number {
  const timestampDifference = getRecordTimestamp(right) - getRecordTimestamp(left);
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return left.path.localeCompare(right.path);
}

function normalizeExecutionRootRecord(value: unknown): ExecutionRootRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Partial<ExecutionRootRecord>;
  if (typeof record.root_id !== 'string' || typeof record.path !== 'string') {
    return null;
  }

  const kind: ExecutionRootKind = record.kind === 'worktree' ? 'worktree' : 'primary';
  const status: ExecutionRootStatus = record.status === 'attached'
    || record.status === 'detached'
    || record.status === 'missing'
    || record.status === 'stale'
    ? record.status
    : 'detached';

  return {
    root_id: record.root_id,
    path: record.path,
    kind,
    branch: normalizeOptionalString(record.branch),
    head: normalizeOptionalString(record.head),
    attached_change_id: normalizeOptionalString(record.attached_change_id),
    owner_session_id: normalizeOptionalString(record.owner_session_id),
    created_at: typeof record.created_at === 'string' ? record.created_at : new Date().toISOString(),
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : new Date().toISOString(),
    status,
  };
}

function getExecutionRootsPath(startDir = process.cwd()): string {
  return path.join(resolveSuperplanRoot(startDir), 'runtime', 'execution-roots.json');
}

function getGitValue(workspaceRoot: string, args: string[]): string | null {
  const result = spawnSync('git', ['-C', workspaceRoot, ...args], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return null;
  }

  const value = result.stdout.trim();
  return value ? value : null;
}

function normalizeWorkspacePath(rootPath: string): string {
  return resolveWorkspaceRoot(rootPath);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getPrimaryCheckoutPath(startDir = process.cwd()): string {
  const identity = resolveProjectIdentity(startDir);
  if (!identity.git_common_dir) {
    return identity.workspace_root;
  }

  if (path.basename(identity.git_common_dir) === '.git') {
    return path.dirname(identity.git_common_dir);
  }

  return identity.workspace_root;
}

function getExecutionRootKindForPath(rootPath: string, startDir = process.cwd()): ExecutionRootKind {
  const workspaceRoot = normalizeWorkspacePath(rootPath);
  return workspaceRoot === getPrimaryCheckoutPath(startDir) ? 'primary' : 'worktree';
}

export function getExecutionRootId(rootPath: string): string {
  return createHash('sha1').update(rootPath).digest('hex').slice(0, 12);
}

export async function readExecutionRootsState(startDir = process.cwd()): Promise<ExecutionRootsState> {
  const parsed = await readJsonFile<Partial<ExecutionRootsState>>(getExecutionRootsPath(startDir), createEmptyExecutionRootsState());
  const roots = parsed.roots && typeof parsed.roots === 'object' ? parsed.roots : {};

  return {
    version: 1,
    roots: Object.fromEntries(
      Object.entries(roots)
        .map(([rootId, value]) => [rootId, normalizeExecutionRootRecord(value)])
        .filter((entry): entry is [string, ExecutionRootRecord] => entry[1] !== null),
    ),
  };
}

export async function writeExecutionRootsState(state: ExecutionRootsState, startDir = process.cwd()): Promise<void> {
  await writeJsonAtomic(getExecutionRootsPath(startDir), state);
}

function getManagedWorktreeBranchName(changeId: string): string {
  return `sp/${changeId}`;
}

function createExecutionRootRecord(startDir = process.cwd(), options: {
  rootPath?: string;
  attachedChangeId?: string | null;
  ownerSessionId?: string | null;
  status?: ExecutionRootStatus;
} = {}): ExecutionRootRecord {
  const workspaceRoot = normalizeWorkspacePath(options.rootPath ?? startDir);
  const timestamp = new Date().toISOString();

  return {
    root_id: getExecutionRootId(workspaceRoot),
    path: workspaceRoot,
    kind: getExecutionRootKindForPath(workspaceRoot, startDir),
    branch: getGitValue(workspaceRoot, ['branch', '--show-current']),
    head: getGitValue(workspaceRoot, ['rev-parse', 'HEAD']),
    attached_change_id: normalizeOptionalString(options.attachedChangeId),
    owner_session_id: normalizeOptionalString(options.ownerSessionId ?? getSuperplanSessionId()),
    created_at: timestamp,
    updated_at: timestamp,
    status: options.status ?? (options.attachedChangeId ? 'attached' : 'detached'),
  };
}

async function refreshExecutionRootRecord(record: ExecutionRootRecord, startDir = process.cwd()): Promise<ExecutionRootRecord> {
  const exists = await pathExists(record.path);
  if (!exists) {
    return {
      ...record,
      status: 'missing',
    };
  }

  const branch = getGitValue(record.path, ['branch', '--show-current']);
  const head = getGitValue(record.path, ['rev-parse', 'HEAD']);
  const kind = getExecutionRootKindForPath(record.path, startDir);
  let status: ExecutionRootStatus = record.attached_change_id ? 'attached' : 'detached';
  if (record.attached_change_id && kind === 'worktree' && branch !== getManagedWorktreeBranchName(record.attached_change_id)) {
    status = 'stale';
  }

  return {
    ...record,
    kind,
    branch,
    head,
    status,
  };
}

function executionRootRecordChanged(left: ExecutionRootRecord, right: ExecutionRootRecord): boolean {
  return left.kind !== right.kind
    || left.branch !== right.branch
    || left.head !== right.head
    || left.status !== right.status
    || left.attached_change_id !== right.attached_change_id
    || left.owner_session_id !== right.owner_session_id;
}

async function refreshExecutionRootsState(startDir = process.cwd()): Promise<ExecutionRootsState> {
  return await withProjectStateLock(async () => {
    const state = await readExecutionRootsState(startDir);
    let changed = false;

    for (const [rootId, record] of Object.entries(state.roots)) {
      const refreshed = await refreshExecutionRootRecord(record, startDir);
      if (!executionRootRecordChanged(record, refreshed)) {
        continue;
      }

      state.roots[rootId] = {
        ...refreshed,
        updated_at: new Date().toISOString(),
      };
      changed = true;
    }

    if (changed) {
      await writeExecutionRootsState(state, startDir);
    }

    return state;
  }, startDir);
}

export async function getExecutionRootRecordByPath(
  workspaceRoot = resolveWorkspaceRoot(),
  startDir = process.cwd(),
): Promise<ExecutionRootRecord | null> {
  const state = await refreshExecutionRootsState(startDir);
  const targetPath = workspaceRoot;
  return Object.values(state.roots).find(record => record.path === targetPath) ?? null;
}

export async function getCurrentExecutionRootRecord(startDir = process.cwd()): Promise<ExecutionRootRecord | null> {
  return await getExecutionRootRecordByPath(resolveWorkspaceRoot(startDir), startDir);
}

export async function listExecutionRoots(startDir = process.cwd()): Promise<ExecutionRootRecord[]> {
  const state = await refreshExecutionRootsState(startDir);
  const records = Object.values(state.roots);

  return records.sort((left, right) => left.path.localeCompare(right.path));
}

export async function findExecutionRootForChange(changeId: string, startDir = process.cwd()): Promise<ExecutionRootRecord | null> {
  const roots = await listExecutionRoots(startDir);
  return roots
    .filter(record => record.attached_change_id === changeId && record.status === 'attached')
    .sort(sortExecutionRootsByFreshness)[0] ?? null;
}

export async function findStaleExecutionRootForChange(changeId: string, startDir = process.cwd()): Promise<ExecutionRootRecord | null> {
  const roots = await listExecutionRoots(startDir);
  return roots
    .filter(record => record.attached_change_id === changeId && record.status === 'stale')
    .sort(sortExecutionRootsByFreshness)[0] ?? null;
}

export function applyExecutionRootAttachment(options: {
  state: ExecutionRootsState;
  rootPath: string;
  startDir: string;
  changeId: string | null;
  ownerSessionId?: string | null;
}): ExecutionRootRecord {
  const existing = Object.values(options.state.roots).find(record => record.path === options.rootPath) ?? null;
  const nextRecord = createExecutionRootRecord(options.startDir, {
    rootPath: options.rootPath,
    attachedChangeId: options.changeId,
    ownerSessionId: options.ownerSessionId,
    status: options.changeId ? 'attached' : 'detached',
  });

  for (const [rootId, record] of Object.entries(options.state.roots)) {
    if (!options.changeId || record.attached_change_id !== options.changeId || rootId === nextRecord.root_id) {
      continue;
    }

    options.state.roots[rootId] = {
      ...record,
      attached_change_id: null,
      owner_session_id: null,
      status: 'detached',
      updated_at: new Date().toISOString(),
    };
  }

  options.state.roots[nextRecord.root_id] = {
    ...nextRecord,
    created_at: existing?.created_at ?? nextRecord.created_at,
  };

  return options.state.roots[nextRecord.root_id];
}

export async function attachCurrentExecutionRoot(options: {
  changeId: string | null;
  ownerSessionId?: string | null;
  startDir?: string;
}): Promise<ExecutionRootRecord> {
  const startDir = options.startDir ?? process.cwd();

  return await withProjectStateLock(async () => {
    const state = await readExecutionRootsState(startDir);
    const workspaceRoot = normalizeWorkspacePath(startDir);
    const nextRecord = applyExecutionRootAttachment({
      state,
      rootPath: workspaceRoot,
      startDir,
      changeId: options.changeId,
      ownerSessionId: options.ownerSessionId,
    });

    await writeExecutionRootsState(state, startDir);
    return nextRecord;
  }, startDir);
}

export async function attachExecutionRootByPath(options: {
  rootPath: string;
  changeId: string | null;
  ownerSessionId?: string | null;
  startDir?: string;
}): Promise<ExecutionRootRecord> {
  const startDir = options.startDir ?? options.rootPath;

  return await withProjectStateLock(async () => {
    const state = await readExecutionRootsState(startDir);
    const workspaceRoot = normalizeWorkspacePath(options.rootPath);
    const nextRecord = applyExecutionRootAttachment({
      state,
      rootPath: workspaceRoot,
      startDir,
      changeId: options.changeId,
      ownerSessionId: options.ownerSessionId,
    });

    await writeExecutionRootsState(state, startDir);
    return nextRecord;
  }, startDir);
}

export async function detachExecutionRootByChange(changeId: string, startDir = process.cwd()): Promise<boolean> {
  return await withProjectStateLock(async () => {
    const state = await readExecutionRootsState(startDir);
    let changed = false;

    for (const [rootId, record] of Object.entries(state.roots)) {
      if (record.attached_change_id !== changeId) {
        continue;
      }

      state.roots[rootId] = {
        ...record,
        attached_change_id: null,
        owner_session_id: null,
        status: 'detached',
        updated_at: new Date().toISOString(),
      };
      changed = true;
    }

    if (changed) {
      await writeExecutionRootsState(state, startDir);
    }

    return changed;
  }, startDir);
}

export async function markMissingExecutionRoots(startDir = process.cwd()): Promise<ExecutionRootRecord[]> {
  const previousState = await readExecutionRootsState(startDir);
  const nextState = await refreshExecutionRootsState(startDir);
  const updated: ExecutionRootRecord[] = [];

  for (const [rootId, record] of Object.entries(nextState.roots)) {
    const previousRecord = previousState.roots[rootId];
    if (!previousRecord || executionRootRecordChanged(previousRecord, record)) {
      updated.push(record);
    }
  }

  return updated;
}

export async function pruneDetachedMissingExecutionRoots(startDir = process.cwd()): Promise<string[]> {
  return await withProjectStateLock(async () => {
    const state = await readExecutionRootsState(startDir);
    const removed: string[] = [];

    for (const [rootId, record] of Object.entries(state.roots)) {
      if (record.status !== 'missing' || record.attached_change_id) {
        continue;
      }

      delete state.roots[rootId];
      removed.push(rootId);
    }

    if (removed.length > 0) {
      await writeExecutionRootsState(state, startDir);
    }

    return removed;
  }, startDir);
}

export function getSuggestedWorktreeRoot(changeId: string, startDir = process.cwd()): string {
  const primaryCheckoutPath = getPrimaryCheckoutPath(startDir);
  const repoName = path.basename(primaryCheckoutPath);
  return path.join(path.dirname(primaryCheckoutPath), '.superplan-worktrees', repoName, changeId);
}
