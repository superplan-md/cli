import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

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

function sanitizeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function normalizeRealPath(targetPath: string): string {
  const resolvedPath = path.isAbsolute(targetPath) ? targetPath : path.resolve(targetPath);

  try {
    return fs.realpathSync(resolvedPath);
  } catch {
    return path.resolve(resolvedPath);
  }
}

function resolveGitPath(workspaceRoot: string, revParseFlag: '--git-dir' | '--git-common-dir'): string | null {
  const result = spawnSync('git', ['-C', workspaceRoot, 'rev-parse', revParseFlag], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout.trim();
  if (!output) {
    return null;
  }

  return normalizeRealPath(path.isAbsolute(output) ? output : path.resolve(workspaceRoot, output));
}

function getProjectNameFromIdentitySource(identitySource: string, workspaceRoot: string): string {
  const identityBaseName = path.basename(identitySource);
  if (identityBaseName === '.git') {
    return sanitizeSegment(path.basename(path.dirname(identitySource)) || path.basename(workspaceRoot) || 'root') || 'root';
  }

  return sanitizeSegment(identityBaseName || path.basename(workspaceRoot) || 'root') || 'root';
}

function getLegacyWorkspaceDirName(workspacePath: string): string {
  const workspaceName = sanitizeSegment(path.basename(workspacePath));
  return `workspace-${workspaceName || 'root'}`;
}

function migrateLegacyProjectState(projectStateRoot: string, legacyStateRoot: string): void {
  if (projectStateRoot === legacyStateRoot || pathExists(projectStateRoot) || !pathExists(legacyStateRoot)) {
    return;
  }

  fs.mkdirSync(path.dirname(projectStateRoot), { recursive: true });

  try {
    fs.renameSync(legacyStateRoot, projectStateRoot);
    return;
  } catch (error: any) {
    if (error?.code !== 'EXDEV') {
      return;
    }
  }

  fs.cpSync(legacyStateRoot, projectStateRoot, { recursive: true });
  fs.rmSync(legacyStateRoot, { recursive: true, force: true });
}

export interface ProjectIdentity {
  start_dir: string;
  workspace_root: string;
  legacy_state_root: string;
  project_id: string;
  project_dir_name: string;
  project_state_root: string;
  is_git_repo: boolean;
  git_dir: string | null;
  git_common_dir: string | null;
  is_linked_worktree: boolean;
}

export function resolveWorkspaceRoot(startDir = process.cwd()): string {
  const resolvedStartDir = resolveStartDir(startDir);
  let currentDir = resolvedStartDir;

  while (true) {
    if (pathExists(path.join(currentDir, '.git'))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return resolvedStartDir;
}

export function resolveProjectIdentity(startDir = process.cwd()): ProjectIdentity {
  const workspaceRoot = resolveWorkspaceRoot(startDir);
  const gitDir = resolveGitPath(workspaceRoot, '--git-dir');
  const gitCommonDir = resolveGitPath(workspaceRoot, '--git-common-dir');
  const isGitRepo = gitDir !== null && gitCommonDir !== null;
  const identitySource = gitCommonDir ?? workspaceRoot;
  const projectHash = createHash('sha1').update(identitySource).digest('hex').slice(0, 10);
  const projectName = getProjectNameFromIdentitySource(identitySource, workspaceRoot);
  const projectDirName = `project-${projectName}-${projectHash}`;
  const projectStateRoot = path.join(os.homedir(), '.config', 'superplan', projectDirName);
  const legacyStateRoot = path.join(os.homedir(), '.config', 'superplan', getLegacyWorkspaceDirName(workspaceRoot));

  migrateLegacyProjectState(projectStateRoot, legacyStateRoot);

  return {
    start_dir: resolveStartDir(startDir),
    workspace_root: workspaceRoot,
    legacy_state_root: legacyStateRoot,
    project_id: projectHash,
    project_dir_name: projectDirName,
    project_state_root: projectStateRoot,
    is_git_repo: isGitRepo,
    git_dir: gitDir,
    git_common_dir: gitCommonDir,
    is_linked_worktree: Boolean(isGitRepo && gitDir && gitCommonDir && gitDir !== gitCommonDir),
  };
}

export function resolveProjectStateRoot(startDir = process.cwd()): string {
  return resolveProjectIdentity(startDir).project_state_root;
}

export function resolveLegacySuperplanRoot(startDir = process.cwd()): string {
  return resolveProjectIdentity(startDir).legacy_state_root;
}

export function getWorkspaceDirName(workspacePath: string): string {
  return getLegacyWorkspaceDirName(workspacePath);
}

export function resolvePathForDisplay(targetPath: string): string {
  return resolveStartDir(targetPath);
}
