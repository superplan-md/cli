import * as fs from 'fs';
import * as path from 'path';

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

export function resolveWorkspaceRoot(startDir = process.cwd()): string {
  const resolvedStartDir = resolveStartDir(startDir);
  let currentDir = resolvedStartDir;
  let gitRoot: string | null = null;

  while (true) {
    if (pathExists(path.join(currentDir, '.superplan'))) {
      return currentDir;
    }

    if (gitRoot === null && pathExists(path.join(currentDir, '.git'))) {
      gitRoot = currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return gitRoot ?? resolvedStartDir;
}

export function resolveSuperplanRoot(startDir = process.cwd()): string {
  return path.join(resolveWorkspaceRoot(startDir), '.superplan');
}
