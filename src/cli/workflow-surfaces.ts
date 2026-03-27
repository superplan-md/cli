import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveWorkspaceRoot } from './workspace-root';

export interface PackageScriptSignals {
  scripts: Record<string, string>;
  run_commands: string[];
  verify_commands: string[];
}

export interface WorkflowSurfaceSummary {
  workspace_root: string;
  planning_surfaces: string[];
  execution_surfaces: string[];
  verification_surfaces: string[];
  native_harness_paths: string[];
  package_scripts: PackageScriptSignals;
}

interface NamedPath {
  label: string;
  relativePath: string;
}

const HARNESS_DIRECTORIES = [
  '.codex',
  '.claude',
  '.cursor',
  '.opencode',
  '.amazonq',
  '.agents',
  '.github',
] as const;

const SKILL_DIRECTORIES: NamedPath[] = [
  { label: 'codex skill', relativePath: '.codex/skills' },
  { label: 'claude skill', relativePath: '.claude/skills' },
  { label: 'cursor skill', relativePath: '.cursor/skills' },
  { label: 'opencode skill', relativePath: '.opencode/skills' },
  { label: 'superplan skill', relativePath: '.superplan/skills' },
];

const WORKFLOW_DIRECTORIES: NamedPath[] = [
  { label: 'workflow', relativePath: '.agents/workflows' },
  { label: 'amazonq rule', relativePath: '.amazonq/rules' },
];

const FILE_SURFACES: Array<NamedPath & { planning?: boolean; execution?: boolean; verification?: boolean }> = [
  {
    label: 'copilot instructions',
    relativePath: '.github/copilot-instructions.md',
    planning: true,
    execution: true,
    verification: true,
  },
  {
    label: 'repo agent contract',
    relativePath: 'AGENTS.md',
    planning: true,
    execution: true,
    verification: true,
  },
];

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function scriptToCommand(scriptName: string): string {
  if (scriptName === 'test') {
    return 'npm test';
  }

  if (scriptName === 'start') {
    return 'npm start';
  }

  return `npm run ${scriptName}`;
}

function isPlanningName(value: string): boolean {
  return /(plan|brainstorm|shape|spec|design|route|entry)/i.test(value);
}

function isVerificationName(value: string): boolean {
  return /(verify|verification|review|check|test|qa|release|guard|lint|validate)/i.test(value);
}

function isExecutionName(value: string): boolean {
  return /(execute|execution|run|debug|tdd|handoff|task|workflow|build|dev|start)/i.test(value);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readDirectoryNames(targetPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries
      .filter(entry => !entry.name.startsWith('.'))
      .map(entry => entry.isFile() ? entry.name.replace(/\.[^.]+$/, '') : entry.name);
  } catch {
    return [];
  }
}

async function readPackageScripts(workspaceRoot: string): Promise<PackageScriptSignals> {
  const packageJsonPath = path.join(workspaceRoot, 'package.json');

  try {
    const content = await fs.readFile(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(content) as { scripts?: Record<string, string> };
    const scripts = parsed.scripts ?? {};
    const runCommands = Object.keys(scripts)
      .filter(name => /^(start|dev|serve|preview)(:|$)/.test(name))
      .map(scriptToCommand);
    const verifyCommands = Object.keys(scripts)
      .filter(name => /^(test|build|lint|check|verify|typecheck|coverage|e2e|validate|qa)(:|$)/.test(name))
      .map(scriptToCommand);

    return {
      scripts,
      run_commands: unique(runCommands),
      verify_commands: unique(verifyCommands),
    };
  } catch {
    return {
      scripts: {},
      run_commands: [],
      verify_commands: [],
    };
  }
}

export async function detectWorkflowSurfaces(cwd = process.cwd()): Promise<WorkflowSurfaceSummary> {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const planningSurfaces: string[] = [];
  const executionSurfaces: string[] = [];
  const verificationSurfaces: string[] = [];
  const nativeHarnessPaths: string[] = [];

  for (const relativePath of HARNESS_DIRECTORIES) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    if (await pathExists(absolutePath)) {
      nativeHarnessPaths.push(relativePath);
    }
  }

  for (const { label, relativePath } of SKILL_DIRECTORIES) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    const names = await readDirectoryNames(absolutePath);
    for (const name of names) {
      const descriptor = `${label}: ${name}`;
      if (isPlanningName(name)) {
        planningSurfaces.push(descriptor);
      }
      if (isExecutionName(name) || !isPlanningName(name)) {
        executionSurfaces.push(descriptor);
      }
      if (isVerificationName(name)) {
        verificationSurfaces.push(descriptor);
      }
    }
  }

  for (const { label, relativePath } of WORKFLOW_DIRECTORIES) {
    const absolutePath = path.join(workspaceRoot, relativePath);
    const names = await readDirectoryNames(absolutePath);
    for (const name of names) {
      const descriptor = `${label}: ${name}`;
      if (isPlanningName(name)) {
        planningSurfaces.push(descriptor);
      }
      executionSurfaces.push(descriptor);
      if (isVerificationName(name)) {
        verificationSurfaces.push(descriptor);
      }
    }
  }

  for (const surface of FILE_SURFACES) {
    const absolutePath = path.join(workspaceRoot, surface.relativePath);
    if (!await pathExists(absolutePath)) {
      continue;
    }
    if (surface.planning) {
      planningSurfaces.push(`${surface.label}: ${surface.relativePath}`);
    }
    if (surface.execution) {
      executionSurfaces.push(`${surface.label}: ${surface.relativePath}`);
    }
    if (surface.verification) {
      verificationSurfaces.push(`${surface.label}: ${surface.relativePath}`);
    }
  }

  const packageScripts = await readPackageScripts(workspaceRoot);
  planningSurfaces.push(...Object.keys(packageScripts.scripts)
    .filter(name => /^(plan|spec|design)(:|$)/.test(name))
    .map(name => `package script: ${name}`));
  executionSurfaces.push(...packageScripts.run_commands.map(command => `package script: ${command}`));
  verificationSurfaces.push(...packageScripts.verify_commands.map(command => `package script: ${command}`));

  return {
    workspace_root: workspaceRoot,
    planning_surfaces: unique(planningSurfaces),
    execution_surfaces: unique(executionSurfaces),
    verification_surfaces: unique(verificationSurfaces),
    native_harness_paths: unique(nativeHarnessPaths),
    package_scripts: packageScripts,
  };
}
