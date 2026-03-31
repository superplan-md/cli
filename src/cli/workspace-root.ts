import * as fs from 'fs';
import * as path from 'path';
import {
  getWorkspaceDirName,
  resolvePathForDisplay,
  resolveProjectIdentity,
  resolveProjectStateRoot,
  resolveWorkspaceRoot,
} from './project-identity';

function pathExists(targetPath: string): boolean {
  try {
    fs.accessSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

function resolveStartDir(startDir: string): string {
  try {
    return fs.realpathSync(startDir);
  } catch {
    return path.resolve(startDir);
  }
}

function isSameOrDescendant(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function toDisplaySlashes(targetPath: string): string {
  return targetPath.split(path.sep).join('/');
}

export { getWorkspaceDirName, resolveWorkspaceRoot };

export function resolveSuperplanRoot(startDir = process.cwd()): string {
  return resolveProjectStateRoot(startDir);
}

export function getProjectIdentity(startDir = process.cwd()) {
  return resolveProjectIdentity(startDir);
}

export function formatCliPath(targetPath: string, startDir = process.cwd()): string {
  const resolvedStartDir = resolveStartDir(startDir);
  const resolvedTargetPath = resolvePathForDisplay(targetPath);
  const resolvedWorkspaceRoot = resolveWorkspaceRoot(startDir);
  const resolvedSuperplanRoot = resolvePathForDisplay(resolveSuperplanRoot(startDir));

  if (resolvedStartDir === resolvedWorkspaceRoot && isSameOrDescendant(resolvedSuperplanRoot, resolvedTargetPath)) {
    const relativeToSuperplanRoot = path.relative(resolvedSuperplanRoot, resolvedTargetPath);
    return toDisplaySlashes(path.join('.superplan', relativeToSuperplanRoot));
  }

  return toDisplaySlashes(path.relative(resolvedStartDir, resolvedTargetPath) || resolvedTargetPath);
}
