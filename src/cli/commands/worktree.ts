import * as fs from 'fs/promises';
import * as path from 'path';
import { clearSessionFocusForChange, setSessionFocus, setSessionFocusUnlocked } from '../session-focus';
import {
  applyExecutionRootAttachment,
  detachExecutionRootByChange,
  type ExecutionRootRecord,
  findExecutionRootForChange,
  getCurrentExecutionRootRecord,
  listExecutionRoots,
  markMissingExecutionRoots,
  pruneDetachedMissingExecutionRoots,
  readExecutionRootsState,
  writeExecutionRootsState,
} from '../execution-roots';
import { ensureGitWorktree, isGitWorktreeClean, pruneGitWorktrees } from '../git-worktree';
import { resolveProjectIdentity, resolveWorkspaceRoot } from '../project-identity';
import { withProjectStateLock } from '../state-lock';
import { isValidChangeSlug } from './scaffold';
import { commandNextAction, stopNextAction, type NextAction } from '../next-action';
import { formatCliPath, resolveSuperplanRoot } from '../workspace-root';

export type WorktreeResult =
  | {
      ok: true;
      data: {
        change_id?: string;
        execution_root?: string;
        branch?: string | null;
        created?: boolean;
        reused?: boolean;
        kind?: 'primary' | 'worktree';
        roots?: Awaited<ReturnType<typeof listExecutionRoots>>;
        removed_root_ids?: string[];
        next_action: NextAction;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function getPositionalArgs(args: string[]): string[] {
  return args.filter(arg => arg !== '--json' && arg !== '--quiet');
}

async function changeHasInProgressTask(changeId: string | null | undefined): Promise<boolean> {
  if (!changeId) {
    return false;
  }

  try {
    const content = await fs.readFile(path.join(resolveSuperplanRoot(), 'runtime', 'tasks.json'), 'utf-8');
    const runtimeState = JSON.parse(content) as {
      changes?: Record<string, { tasks?: Record<string, { status?: string }> }>;
    };
    const changeState = runtimeState.changes?.[changeId];
    if (!changeState?.tasks) {
      return false;
    }

    return Object.values(changeState.tasks).some(taskState => taskState?.status === 'in_progress');
  } catch {
    return false;
  }
}

export function getWorktreeCommandHelpMessage(): string {
  return [
    'Superplan worktree command requires a subcommand.',
    '',
    'Worktree commands:',
    '  ensure <change-slug>                 Ensure an execution root is attached to a change',
    '  list                                 List known execution roots for this project',
    '  detach <change-slug>                 Detach any execution root currently attached to a change',
    '  prune                                Mark missing worktrees and prune stale detached records',
  ].join('\n');
}

function getInvalidWorktreeCommandError(): WorktreeResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_WORKTREE_COMMAND',
      message: getWorktreeCommandHelpMessage(),
      retryable: true,
    },
  };
}

async function attachExecutionRootAndFocus(options: {
  changeId: string;
  rootPath: string;
  captureCurrentCheckout?: boolean;
}): Promise<ExecutionRootRecord> {
  const startDir = options.captureCurrentCheckout ? process.cwd() : options.rootPath;

  return await withProjectStateLock(async () => {
    const executionRootsState = await readExecutionRootsState(startDir);
    const attachedRoot = applyExecutionRootAttachment({
      state: executionRootsState,
      rootPath: options.rootPath,
      startDir,
      changeId: options.changeId,
    });
    await writeExecutionRootsState(executionRootsState, startDir);
    await setSessionFocusUnlocked({
      startDir,
      focusedChangeId: options.changeId,
      focusedTaskRef: null,
      attachedChangeId: options.changeId,
      executionRootPath: attachedRoot.path,
      executionRootKind: attachedRoot.kind,
    });
    return attachedRoot;
  }, startDir);
}

async function ensureWorktree(changeId: string): Promise<WorktreeResult> {
  if (!isValidChangeSlug(changeId)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

  const identity = resolveProjectIdentity();
  if (!identity.is_git_repo) {
    return {
      ok: false,
      error: {
        code: 'WORKTREE_GIT_REQUIRED',
        message: 'Worktree management requires a Git repository',
        retryable: false,
      },
    };
  }

  const attachedRoot = await findExecutionRootForChange(changeId);
  if (attachedRoot) {
    await setSessionFocus({
      focusedChangeId: changeId,
      focusedTaskRef: null,
      attachedChangeId: changeId,
      executionRootPath: attachedRoot.path,
      executionRootKind: attachedRoot.kind,
    });

    return {
      ok: true,
      data: {
        change_id: changeId,
        execution_root: attachedRoot.path,
        branch: attachedRoot.branch,
        created: false,
        reused: true,
        kind: attachedRoot.kind,
        next_action: stopNextAction(
          `Execution root for ${changeId} is ${formatCliPath(attachedRoot.path)}.`,
          'The change already has an attached execution root, so no new worktree was needed.',
        ),
      },
    };
  }

  const currentRoot = await getCurrentExecutionRootRecord();
  const currentRootClean = isGitWorktreeClean();
  const currentRootFree = !currentRoot?.attached_change_id
    || currentRoot.attached_change_id === changeId
    || currentRoot.status === 'detached'
    || !await changeHasInProgressTask(currentRoot.attached_change_id);
  const currentRootReusable = currentRootFree && currentRootClean && currentRoot?.status !== 'stale';

  if (currentRootReusable) {
    const attachedCurrentRoot = await attachExecutionRootAndFocus({
      changeId,
      rootPath: resolveWorkspaceRoot(),
      captureCurrentCheckout: true,
    });

    return {
      ok: true,
      data: {
        change_id: changeId,
        execution_root: attachedCurrentRoot.path,
        branch: attachedCurrentRoot.branch,
        created: false,
        reused: currentRoot?.attached_change_id === changeId,
        kind: attachedCurrentRoot.kind,
        next_action: stopNextAction(
          `Current checkout is now attached to ${changeId}.`,
          'The current execution root was available, so Superplan reused it instead of creating a linked worktree.',
        ),
      },
    };
  }

  try {
    const ensured = await ensureGitWorktree(changeId);
    const attachedWorktree = await attachExecutionRootAndFocus({
      changeId,
      rootPath: ensured.path,
    });

    return {
      ok: true,
      data: {
        change_id: changeId,
        execution_root: attachedWorktree.path,
        branch: attachedWorktree.branch,
        created: ensured.created,
        reused: ensured.reused,
        kind: attachedWorktree.kind,
        next_action: stopNextAction(
          `Execution root for ${changeId} is ready at ${formatCliPath(attachedWorktree.path)}.`,
          'The current checkout was occupied by other tracked work, so a dedicated execution root was used for this change.',
        ),
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'WORKTREE_ENSURE_FAILED',
        message: error?.message || `Failed to ensure worktree for ${changeId}`,
        retryable: false,
      },
    };
  }
}

async function listWorktrees(): Promise<WorktreeResult> {
  await markMissingExecutionRoots();
  const roots = await listExecutionRoots();

  return {
    ok: true,
    data: {
      roots,
      next_action: commandNextAction(
        'superplan status --json',
        'Execution roots are listed; return to the tracked frontier when choosing work.',
      ),
    },
  };
}

async function detachWorktree(changeId: string): Promise<WorktreeResult> {
  if (!isValidChangeSlug(changeId)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

  const changed = await detachExecutionRootByChange(changeId);
  await clearSessionFocusForChange(changeId);

  return {
    ok: true,
    data: {
      change_id: changeId,
      next_action: changed
        ? commandNextAction(
            'superplan status --json',
            `Detached execution roots for ${changeId}.`,
          )
        : stopNextAction(
            `No execution root was attached to ${changeId}.`,
            'There was nothing to detach for this change.',
          ),
    },
  };
}

async function pruneWorktrees(): Promise<WorktreeResult> {
  try {
    pruneGitWorktrees();
  } catch {}

  await markMissingExecutionRoots();
  const removedRootIds = await pruneDetachedMissingExecutionRoots();
  const roots = await listExecutionRoots();

  return {
    ok: true,
    data: {
      removed_root_ids: removedRootIds,
      roots,
      next_action: commandNextAction(
        'superplan status --json',
        'Execution-root metadata is pruned; continue from the active frontier.',
      ),
    },
  };
}

export async function worktree(args: string[]): Promise<WorktreeResult> {
  const positionalArgs = getPositionalArgs(args);
  const action = positionalArgs[0];

  if (!action) {
    return getInvalidWorktreeCommandError();
  }

  if (action === 'list') {
    return await listWorktrees();
  }

  if (action === 'prune') {
    return await pruneWorktrees();
  }

  const changeId = positionalArgs[1];
  if (!changeId) {
    return getInvalidWorktreeCommandError();
  }

  if (action === 'ensure') {
    return await ensureWorktree(changeId);
  }

  if (action === 'detach') {
    return await detachWorktree(changeId);
  }

  return getInvalidWorktreeCommandError();
}
