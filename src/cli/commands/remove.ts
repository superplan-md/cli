import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { confirm, select } from '@inquirer/prompts';

interface AgentEnvironment {
  name: string;
  path: string;
  install_path: string;
  install_kind: 'toml_command' | 'skills_namespace';
  cleanup_paths?: string[];
}

type RemoveScope = 'global' | 'local' | 'both' | 'skip';
type AgentScope = 'project' | 'global';
type RemoveMode = 'remove' | 'purge';

export interface RemoveOptions {
  json?: boolean;
  quiet?: boolean;
}

export type RemoveResult =
  | {
      ok: true;
      data: {
        scope: RemoveScope;
        mode: RemoveMode;
        removed_paths: string[];
        agents: AgentEnvironment[];
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getAgentDefinitions(baseDir: string, scope: AgentScope): AgentEnvironment[] {
  if (scope === 'project') {
    return [
      {
        name: 'claude',
        path: path.join(baseDir, '.claude'),
        install_path: path.join(baseDir, '.claude', 'skills'),
        install_kind: 'skills_namespace',
        cleanup_paths: [path.join(baseDir, '.claude', 'commands', 'superplan.md')],
      },
      {
        name: 'gemini',
        path: path.join(baseDir, '.gemini'),
        install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
        install_kind: 'toml_command',
      },
      {
        name: 'cursor',
        path: path.join(baseDir, '.cursor'),
        install_path: path.join(baseDir, '.cursor', 'skills'),
        install_kind: 'skills_namespace',
        cleanup_paths: [path.join(baseDir, '.cursor', 'commands', 'superplan.md')],
      },
      {
        name: 'codex',
        path: path.join(baseDir, '.codex'),
        install_path: path.join(baseDir, '.codex', 'skills'),
        install_kind: 'skills_namespace',
        cleanup_paths: [path.join(baseDir, '.codex', 'skills', 'superplan')],
      },
      {
        name: 'opencode',
        path: path.join(baseDir, '.opencode'),
        install_path: path.join(baseDir, '.opencode', 'skills'),
        install_kind: 'skills_namespace',
        cleanup_paths: [path.join(baseDir, '.opencode', 'commands', 'superplan.md')],
      },
    ];
  }

  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      install_path: path.join(baseDir, '.claude', 'skills'),
      install_kind: 'skills_namespace',
      cleanup_paths: [path.join(baseDir, '.claude', 'commands', 'superplan.md')],
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
      install_kind: 'toml_command',
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      install_path: path.join(baseDir, '.cursor', 'skills'),
      install_kind: 'skills_namespace',
      cleanup_paths: [path.join(baseDir, '.cursor', 'commands', 'superplan.md')],
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      install_path: path.join(baseDir, '.codex', 'skills'),
      install_kind: 'skills_namespace',
      cleanup_paths: [path.join(baseDir, '.codex', 'skills', 'superplan')],
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.config', 'opencode'),
      install_path: path.join(baseDir, '.config', 'opencode', 'skills'),
      install_kind: 'skills_namespace',
      cleanup_paths: [path.join(baseDir, '.config', 'opencode', 'commands', 'superplan.md')],
    },
  ];
}

async function getManagedSkillNames(sourceSkillsDir: string): Promise<string[]> {
  const entries = await fs.readdir(sourceSkillsDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function getManagedInstallPaths(agent: AgentEnvironment, managedSkillNames: string[]): string[] {
  if (agent.install_kind === 'skills_namespace') {
    return [
      ...managedSkillNames.map(skillName => path.join(agent.install_path, skillName)),
      ...(agent.cleanup_paths ?? []),
    ];
  }

  return [
    agent.install_path,
    ...(agent.cleanup_paths ?? []),
  ];
}

async function detectAgents(baseDir: string, scope: AgentScope, managedSkillNames: string[]): Promise<AgentEnvironment[]> {
  const definitions = getAgentDefinitions(baseDir, scope);
  const detectedAgents: AgentEnvironment[] = [];

  for (const agent of definitions) {
    const managedInstallPaths = getManagedInstallPaths(agent, managedSkillNames);
    const hasManagedInstall = (await Promise.all(managedInstallPaths.map(targetPath => pathExists(targetPath)))).some(Boolean);

    if (hasManagedInstall) {
      detectedAgents.push(agent);
    }
  }

  return detectedAgents;
}

async function removePath(targetPath: string, removedPaths: string[]): Promise<void> {
  if (!await pathExists(targetPath)) {
    return;
  }

  await fs.rm(targetPath, { recursive: true, force: true });
  removedPaths.push(targetPath);
}

async function removeAgentInstalls(
  agents: AgentEnvironment[],
  managedSkillNames: string[],
  removedPaths: string[],
): Promise<void> {
  for (const agent of agents) {
    for (const managedPath of getManagedInstallPaths(agent, managedSkillNames)) {
      await removePath(managedPath, removedPaths);
    }
  }
}

async function removeCommand(mode: RemoveMode, options: RemoveOptions): Promise<RemoveResult> {
  try {
    if (options.json || options.quiet) {
      return {
        ok: false,
        error: {
          code: 'INTERACTIVE_REQUIRED',
          message: `${mode} must be run interactively`,
          retryable: false,
        },
      };
    }

    const cwd = process.cwd();
    const homeDir = os.homedir();
    const sourceSkillsDir = path.resolve(__dirname, '../../skills');
    const managedSkillNames = await getManagedSkillNames(sourceSkillsDir);

    const globalSuperplanDir = path.join(homeDir, '.config', 'superplan');
    const localSuperplanDir = path.join(cwd, '.superplan');
    const localChangesDir = path.join(cwd, 'changes');

    const scope = await select<RemoveScope>({
      message: `Where do you want to ${mode} Superplan?`,
      choices: [
        { name: 'Global (machine-level)', value: 'global' },
        { name: 'Local (current repository)', value: 'local' },
        { name: 'Both', value: 'both' },
        { name: 'Skip', value: 'skip' },
      ],
    });

    if (scope === 'skip') {
      return {
        ok: true,
        data: {
          scope,
          mode,
          removed_paths: [],
          agents: [],
        },
      };
    }

    const proceed = await confirm({ message: `Proceed with ${mode}?` });
    if (!proceed) {
      return {
        ok: false,
        error: {
          code: 'USER_ABORTED',
          message: `${mode} aborted by user`,
          retryable: false,
        },
      };
    }

    const removedPaths: string[] = [];
    const globalAgents = scope === 'global' || scope === 'both'
      ? await detectAgents(homeDir, 'global', managedSkillNames)
      : [];
    const localAgents = scope === 'local' || scope === 'both'
      ? await detectAgents(cwd, 'project', managedSkillNames)
      : [];

    if (scope === 'global' || scope === 'both') {
      await removeAgentInstalls(globalAgents, managedSkillNames, removedPaths);
      await removePath(globalSuperplanDir, removedPaths);
    }

    if (scope === 'local' || scope === 'both') {
      await removeAgentInstalls(localAgents, managedSkillNames, removedPaths);
      await removePath(localSuperplanDir, removedPaths);

      if (mode === 'purge') {
        await removePath(localChangesDir, removedPaths);
      }
    }

    return {
      ok: true,
      data: {
        scope,
        mode,
        removed_paths: removedPaths,
        agents: [...globalAgents, ...localAgents],
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'REMOVE_FAILED',
        message: error.message || 'An unknown error occurred',
        retryable: false,
      },
    };
  }
}

export async function remove(options: RemoveOptions): Promise<RemoveResult> {
  return removeCommand('remove', options);
}

export async function purge(options: RemoveOptions): Promise<RemoveResult> {
  return removeCommand('purge', options);
}
