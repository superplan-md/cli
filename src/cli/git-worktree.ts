import * as fs from 'fs/promises';
import * as path from 'path';
import { spawnSync } from 'node:child_process';
import { getSuggestedWorktreeRoot } from './execution-roots';
import { resolveProjectIdentity, resolveWorkspaceRoot } from './project-identity';

export interface GitWorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

export interface EnsureGitWorktreeResult {
  path: string;
  branch: string;
  created: boolean;
  reused: boolean;
}

function runGit(workspaceRoot: string, args: string[]): { stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', workspaceRoot, ...args], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }

  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function getPrimaryCheckoutPath(startDir = process.cwd()): string {
  const identity = resolveProjectIdentity(startDir);
  if (!identity.is_git_repo) {
    throw new Error('Git worktrees require a Git repository');
  }

  if (identity.git_common_dir && path.basename(identity.git_common_dir) === '.git') {
    return path.dirname(identity.git_common_dir);
  }

  return identity.workspace_root;
}

function getManagedBranchName(changeId: string): string {
  return `sp/${changeId}`;
}

function switchWorktreeToManagedBranch(primaryCheckoutPath: string, worktreePath: string, branch: string): void {
  if (branchExists(primaryCheckoutPath, branch)) {
    runGit(worktreePath, ['checkout', branch]);
    return;
  }

  runGit(worktreePath, ['checkout', '-B', branch, 'HEAD']);
}

function parseGitWorktreeList(stdout: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  const blocks = stdout.trim().split('\n\n').filter(Boolean);

  for (const block of blocks) {
    const entry: GitWorktreeEntry = {
      path: '',
      head: null,
      branch: null,
      detached: false,
      bare: false,
      locked: false,
      prunable: false,
    };

    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      if (line.startsWith('worktree ')) {
        entry.path = line.slice('worktree '.length).trim();
      } else if (line.startsWith('HEAD ')) {
        entry.head = line.slice('HEAD '.length).trim();
      } else if (line.startsWith('branch ')) {
        const branchRef = line.slice('branch '.length).trim();
        entry.branch = branchRef.replace(/^refs\/heads\//, '');
      } else if (line === 'detached') {
        entry.detached = true;
      } else if (line === 'bare') {
        entry.bare = true;
      } else if (line.startsWith('locked')) {
        entry.locked = true;
      } else if (line.startsWith('prunable')) {
        entry.prunable = true;
      }
    }

    if (entry.path) {
      entries.push(entry);
    }
  }

  return entries;
}

function branchExists(primaryCheckoutPath: string, branchName: string): boolean {
  const result = spawnSync('git', ['-C', primaryCheckoutPath, 'show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
    encoding: 'utf-8',
  });

  return result.status === 0;
}

export function listGitWorktrees(startDir = process.cwd()): GitWorktreeEntry[] {
  const primaryCheckoutPath = getPrimaryCheckoutPath(startDir);
  const { stdout } = runGit(primaryCheckoutPath, ['worktree', 'list', '--porcelain']);
  return parseGitWorktreeList(stdout);
}

export function isGitWorktreeClean(startDir = process.cwd()): boolean {
  const workspaceRoot = resolveWorkspaceRoot(startDir);
  const result = spawnSync('git', ['-C', workspaceRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return false;
  }

  return result.stdout.trim() === '';
}

export async function ensureGitWorktree(changeId: string, startDir = process.cwd()): Promise<EnsureGitWorktreeResult> {
  const primaryCheckoutPath = getPrimaryCheckoutPath(startDir);
  const branch = getManagedBranchName(changeId);
  const targetPath = getSuggestedWorktreeRoot(changeId, startDir);
  const worktrees = listGitWorktrees(startDir);
  const existingByBranch = worktrees.find(entry => entry.branch === branch);
  if (existingByBranch) {
    return {
      path: existingByBranch.path,
      branch,
      created: false,
      reused: true,
    };
  }

  const existingByPath = worktrees.find(entry => entry.path === targetPath);
  if (existingByPath) {
    if (existingByPath.branch !== branch) {
      switchWorktreeToManagedBranch(primaryCheckoutPath, existingByPath.path, branch);
    }

    return {
      path: existingByPath.path,
      branch,
      created: false,
      reused: true,
    };
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const args = branchExists(primaryCheckoutPath, branch)
    ? ['worktree', 'add', targetPath, branch]
    : ['worktree', 'add', '-b', branch, targetPath, 'HEAD'];

  runGit(primaryCheckoutPath, args);

  return {
    path: targetPath,
    branch,
    created: true,
    reused: false,
  };
}

export function pruneGitWorktrees(startDir = process.cwd()): void {
  const primaryCheckoutPath = getPrimaryCheckoutPath(startDir);
  runGit(primaryCheckoutPath, ['worktree', 'prune']);
}
