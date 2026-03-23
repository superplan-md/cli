import * as fs from 'fs/promises';
import * as path from 'path';

export interface WorkspaceArtifactPaths {
  superplanRoot: string;
  contextDir: string;
  runtimeDir: string;
  changesDir: string;
  configPath: string;
  contextReadmePath: string;
  contextIndexPath: string;
  decisionsPath: string;
  gotchasPath: string;
  planPath: string;
}

export interface ChangeArtifactPaths {
  changeRoot: string;
  tasksDir: string;
  tasksIndexPath: string;
  specsDir: string;
  specReadmePath: string;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureFile(targetPath: string, content: string): Promise<boolean> {
  if (await pathExists(targetPath)) {
    return false;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf-8');
  return true;
}

export function getWorkspaceArtifactPaths(superplanRoot: string): WorkspaceArtifactPaths {
  const contextDir = path.join(superplanRoot, 'context');
  return {
    superplanRoot,
    contextDir,
    runtimeDir: path.join(superplanRoot, 'runtime'),
    changesDir: path.join(superplanRoot, 'changes'),
    configPath: path.join(superplanRoot, 'config.toml'),
    contextReadmePath: path.join(contextDir, 'README.md'),
    contextIndexPath: path.join(contextDir, 'INDEX.md'),
    decisionsPath: path.join(superplanRoot, 'decisions.md'),
    gotchasPath: path.join(superplanRoot, 'gotchas.md'),
    planPath: path.join(superplanRoot, 'plan.md'),
  };
}

export function getChangeArtifactPaths(changeRoot: string): ChangeArtifactPaths {
  const specsDir = path.join(changeRoot, 'specs');
  return {
    changeRoot,
    tasksDir: path.join(changeRoot, 'tasks'),
    tasksIndexPath: path.join(changeRoot, 'tasks.md'),
    specsDir,
    specReadmePath: path.join(specsDir, 'README.md'),
  };
}

export function buildContextReadme(): string {
  return [
    '# Workspace Context',
    '',
    'Use this directory for durable repo truth that should survive beyond the current task.',
    '',
    'Start with [INDEX.md](./INDEX.md) and add focused docs only when they will help future shaping or execution.',
    '',
  ].join('\n');
}

export function buildContextIndex(): string {
  return [
    '# Context Index',
    '',
    '- Add durable context docs here as they are created.',
    '',
  ].join('\n');
}

export function buildDecisionsLog(): string {
  return [
    '# Decisions',
    '',
    '- Record durable workflow or architecture decisions here when they change how future work should proceed.',
    '',
  ].join('\n');
}

export function buildGotchasLog(): string {
  return [
    '# Gotchas',
    '',
    '- Record recurring traps or misleading repo details here when they are likely to waste time again.',
    '',
  ].join('\n');
}

export function buildWorkspacePlan(): string {
  return [
    '# Workspace Plan',
    '',
    '## Goal',
    '',
    'Describe the current execution target here when trajectory, sequencing, or handoff structure matters.',
    '',
    '## Execution Path',
    '',
    '1. Define the first executable step',
    '   - target:',
    '   - proof:',
    '   - next:',
    '',
  ].join('\n');
}

export async function ensureWorkspaceArtifacts(superplanRoot: string): Promise<string[]> {
  const paths = getWorkspaceArtifactPaths(superplanRoot);

  await fs.mkdir(paths.superplanRoot, { recursive: true });
  await fs.mkdir(paths.contextDir, { recursive: true });
  await fs.mkdir(paths.runtimeDir, { recursive: true });
  await fs.mkdir(paths.changesDir, { recursive: true });

  const created: string[] = [];

  if (await ensureFile(paths.contextReadmePath, buildContextReadme())) {
    created.push(paths.contextReadmePath);
  }

  if (await ensureFile(paths.contextIndexPath, buildContextIndex())) {
    created.push(paths.contextIndexPath);
  }

  if (await ensureFile(paths.decisionsPath, buildDecisionsLog())) {
    created.push(paths.decisionsPath);
  }

  if (await ensureFile(paths.gotchasPath, buildGotchasLog())) {
    created.push(paths.gotchasPath);
  }

  if (await ensureFile(paths.planPath, buildWorkspacePlan())) {
    created.push(paths.planPath);
  }

  return created;
}

export function buildChangeSpecReadme(changeSlug: string, title: string): string {
  return [
    `# ${title} Spec Notes`,
    '',
    `Use this directory for behavior, constraints, and acceptance intent that belong to \`${changeSlug}\`.`,
    '',
    'Add focused spec docs here only when they materially reduce execution risk.',
    '',
  ].join('\n');
}

export async function ensureChangeArtifacts(changeRoot: string, changeSlug: string, title: string): Promise<string[]> {
  const paths = getChangeArtifactPaths(changeRoot);

  await fs.mkdir(paths.tasksDir, { recursive: true });
  await fs.mkdir(paths.specsDir, { recursive: true });

  const created: string[] = [];
  if (await ensureFile(paths.specReadmePath, buildChangeSpecReadme(changeSlug, title))) {
    created.push(paths.specReadmePath);
  }

  return created;
}

