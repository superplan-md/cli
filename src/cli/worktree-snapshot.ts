import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveWorkspaceRoot } from './workspace-root';

const execFile = promisify(execFileCallback);

export interface WorktreeSnapshot {
  workspace_root: string;
  captured_at: string;
  files: Record<string, string>;
}

function normalizeWorkspaceRelativePath(workspaceRoot: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(workspaceRoot, filePath);
  return path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/').replace(/\/+$/, '');
}

async function getGitChangedPaths(workspaceRoot: string): Promise<string[]> {
  try {
    const { stdout } = await execFile('git', ['-C', workspaceRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
      cwd: workspaceRoot,
    });

    return stdout
      .split('\n')
      .map(line => line.trimEnd())
      .filter(Boolean)
      .map(line => {
        const rawPath = line.slice(3);
        const renameSeparator = rawPath.indexOf(' -> ');
        return renameSeparator === -1 ? rawPath : rawPath.slice(renameSeparator + 4);
      })
      .map(filePath => normalizeWorkspaceRelativePath(workspaceRoot, filePath))
      .filter(filePath => filePath && !filePath.startsWith('.superplan/runtime/'))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function fingerprintChangedPath(workspaceRoot: string, filePath: string): Promise<string> {
  const absolutePath = path.join(workspaceRoot, filePath);

  try {
    const stats = await fs.lstat(absolutePath);

    if (stats.isSymbolicLink()) {
      const target = await fs.readlink(absolutePath);
      return `symlink:${target}`;
    }

    if (stats.isFile()) {
      const content = await fs.readFile(absolutePath);
      return `file:${createHash('sha256').update(content).digest('hex')}`;
    }

    if (stats.isDirectory()) {
      return 'directory';
    }

    return `other:${stats.mode}`;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return 'missing';
    }

    return `unreadable:${error?.code ?? 'unknown'}`;
  }
}

export async function collectWorktreeSnapshot(workspaceRoot = resolveWorkspaceRoot()): Promise<WorktreeSnapshot> {
  const normalizedWorkspaceRoot = resolveWorkspaceRoot(workspaceRoot);
  const changedPaths = await getGitChangedPaths(normalizedWorkspaceRoot);
  const files: Record<string, string> = {};

  for (const changedPath of changedPaths) {
    files[changedPath] = await fingerprintChangedPath(normalizedWorkspaceRoot, changedPath);
  }

  return {
    workspace_root: normalizedWorkspaceRoot,
    captured_at: new Date().toISOString(),
    files,
  };
}
