import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { confirm, select } from '@inquirer/prompts';

interface AgentEnvironment {
  name: string;
  path: string;
  skills_path: string;
}

type InstallScope = 'global' | 'local' | 'both' | 'skip';
type AgentScope = 'project' | 'global';

export interface SetupOptions {
  json?: boolean;
}

export type SetupResult =
  | {
      ok: true;
      data: {
        config_path: string;
        skills_path: string;
        scope: InstallScope;
        agents: AgentEnvironment[];
        message?: string;
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

async function ensureGlobalConfig(configPath: string): Promise<void> {
  const initialConfig = `version = "0.1"\n\n[agents]\ninstalled = []\n`;
  await fs.writeFile(configPath, initialConfig, 'utf-8');
}

async function ensureLocalConfig(configPath: string): Promise<void> {
  await fs.writeFile(configPath, 'version = "0.1"\n', 'utf-8');
}

async function installSkills(sourceDir: string, targetDir: string): Promise<void> {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  const stats = await fs.stat(sourceDir);
  if (stats.isDirectory()) {
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
  }
}

function getAgentDefinitions(baseDir: string, scope: AgentScope): AgentEnvironment[] {
  if (scope === 'project') {
    return [
      {
        name: 'claude',
        path: path.join(baseDir, '.claude'),
        skills_path: path.join(baseDir, '.claude', 'skills', 'superplan'),
      },
      {
        name: 'gemini',
        path: path.join(baseDir, '.gemini'),
        skills_path: path.join(baseDir, '.gemini', 'skills', 'superplan'),
      },
      {
        name: 'cursor',
        path: path.join(baseDir, '.cursor'),
        skills_path: path.join(baseDir, '.cursor', 'skills', 'superplan'),
      },
      {
        name: 'codex',
        path: path.join(baseDir, '.codex'),
        skills_path: path.join(baseDir, '.codex', 'skills', 'superplan'),
      },
      {
        name: 'opencode',
        path: path.join(baseDir, '.opencode'),
        skills_path: path.join(baseDir, '.opencode', 'skills', 'superplan'),
      },
    ];
  }

  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      skills_path: path.join(baseDir, '.claude', 'skills', 'superplan'),
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      skills_path: path.join(baseDir, '.gemini', 'skills', 'superplan'),
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      skills_path: path.join(baseDir, '.cursor', 'skills', 'superplan'),
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      skills_path: path.join(baseDir, '.codex', 'skills', 'superplan'),
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.config', 'opencode'),
      skills_path: path.join(baseDir, '.config', 'opencode', 'skills', 'superplan'),
    },
  ];
}

async function detectAgents(baseDir: string, scope: AgentScope): Promise<AgentEnvironment[]> {
  const detectedAgents: AgentEnvironment[] = [];
  const supportedAgents = getAgentDefinitions(baseDir, scope);

  for (const agent of supportedAgents) {
    const agentDir = agent.path;

    try {
      const stat = await fs.stat(agentDir);
      if (stat.isDirectory()) {
        detectedAgents.push(agent);
      }
    } catch {
      // Agent directory doesn't exist
    }
  }

  return detectedAgents;
}

async function installAgentSkills(skillsDir: string, agents: AgentEnvironment[]): Promise<void> {
  for (const agent of agents) {
    const targetDir = agent.skills_path;

    await fs.rm(targetDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(targetDir), { recursive: true });

    try {
      await fs.symlink(skillsDir, targetDir, 'dir');
    } catch {
      await fs.mkdir(targetDir, { recursive: true });
      await fs.cp(skillsDir, targetDir, { recursive: true, force: true });
    }
  }
}

async function ensureSkillsSource(sourceDir: string): Promise<SetupResult | null> {
  try {
    const stats = await fs.stat(sourceDir);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        error: {
          code: 'SKILLS_SOURCE_MISSING',
          message: 'Local skills folder not found in project root',
          retryable: false,
        },
      };
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'SKILLS_SOURCE_MISSING',
        message: 'Local skills folder not found in project root',
        retryable: false,
      },
    };
  }

  return null;
}

async function ensureGlobalSetup(configDir: string, configPath: string, skillsDir: string, sourceSkillsDir: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });

  if (!await pathExists(configPath)) {
    await ensureGlobalConfig(configPath);
  }

  await installSkills(sourceSkillsDir, skillsDir);
}

async function ensureLocalSetup(superplanDir: string, configPath: string, skillsDir: string, changesDir: string, sourceSkillsDir: string): Promise<void> {
  await fs.mkdir(superplanDir, { recursive: true });
  await fs.mkdir(changesDir, { recursive: true });

  if (!await pathExists(configPath)) {
    await ensureLocalConfig(configPath);
  }

  await installSkills(sourceSkillsDir, skillsDir);
}

function getScopePaths(scope: InstallScope, globalConfigPath: string, globalSkillsPath: string, localConfigPath: string, localSkillsPath: string) {
  if (scope === 'local') {
    return {
      config_path: localConfigPath,
      skills_path: localSkillsPath,
    };
  }

  if (scope === 'skip') {
    return {
      config_path: '',
      skills_path: '',
    };
  }

  return {
    config_path: globalConfigPath,
    skills_path: globalSkillsPath,
  };
}

function getNoAgentsMessage(scope: InstallScope, agentCount: number): string | undefined {
  if (agentCount > 0 || scope === 'skip') {
    return undefined;
  }

  if (scope === 'local') {
    return 'No agent environments found in this repo.';
  }

  if (scope === 'global') {
    return 'No agent environments found in your home directory.';
  }

  return 'No agent environments found in this repo or your home directory.';
}

export async function setup(options: SetupOptions): Promise<SetupResult> {
  try {
    if (options.json) {
      return {
        ok: false,
        error: {
          code: 'INTERACTIVE_REQUIRED',
          message: 'setup must be run interactively',
          retryable: false,
        },
      };
    }

    const cwd = process.cwd();
    const homeDir = os.homedir();
    const sourceSkillsDir = path.join(cwd, 'skills');

    const globalConfigDir = path.join(homeDir, '.config', 'superplan');
    const globalConfigPath = path.join(globalConfigDir, 'config.toml');
    const globalSkillsDir = path.join(globalConfigDir, 'skills');

    const localSuperplanDir = path.join(cwd, '.superplan');
    const localConfigPath = path.join(localSuperplanDir, 'config.toml');
    const localSkillsDir = path.join(localSuperplanDir, 'skills');
    const localChangesDir = path.join(cwd, 'changes');

    const alreadySetup = await pathExists(globalConfigPath) || await pathExists(localSuperplanDir);
    if (alreadySetup) {
      const reinstall = await confirm({ message: 'Superplan is already set up. Reinstall?' });
      if (!reinstall) {
        return {
          ok: true,
          data: {
            ...getScopePaths('skip', globalConfigPath, globalSkillsDir, localConfigPath, localSkillsDir),
            scope: 'skip',
            agents: [],
          },
        };
      }
    }

    const scope = await select<InstallScope>({
      message: 'Where do you want to install Superplan?',
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
          ...getScopePaths(scope, globalConfigPath, globalSkillsDir, localConfigPath, localSkillsDir),
          scope,
          agents: [],
        },
      };
    }

    const proceed = await confirm({ message: 'Proceed with setup?' });
    if (!proceed) {
      return {
        ok: false,
        error: {
          code: 'USER_ABORTED',
          message: 'Setup aborted by user',
          retryable: false,
        },
      };
    }

    const skillsSourceError = await ensureSkillsSource(sourceSkillsDir);
    if (skillsSourceError) {
      return skillsSourceError;
    }

    const repoAgents = scope === 'local' || scope === 'both'
      ? await detectAgents(cwd, 'project')
      : [];
    const homeAgents = scope === 'global' || scope === 'both'
      ? await detectAgents(homeDir, 'global')
      : [];

    if (scope === 'global' || scope === 'both') {
      await ensureGlobalSetup(globalConfigDir, globalConfigPath, globalSkillsDir, sourceSkillsDir);
      if (homeAgents.length > 0) {
        await installAgentSkills(globalSkillsDir, homeAgents);
      }
    }

    if (scope === 'local' || scope === 'both') {
      await ensureLocalSetup(localSuperplanDir, localConfigPath, localSkillsDir, localChangesDir, sourceSkillsDir);
      if (repoAgents.length > 0) {
        await installAgentSkills(localSkillsDir, repoAgents);
      }
    }

    const installedAgents = [...homeAgents, ...repoAgents];
    const message = getNoAgentsMessage(scope, installedAgents.length);

    return {
      ok: true,
      data: {
        ...getScopePaths(scope, globalConfigPath, globalSkillsDir, localConfigPath, localSkillsDir),
        scope,
        agents: installedAgents,
        ...(message ? { message } : {}),
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'SETUP_FAILED',
        message: error.message || 'An unknown error occurred',
        retryable: false,
      },
    };
  }
}
