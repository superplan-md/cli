import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { checkbox, confirm, select } from '@inquirer/prompts';
import { writeOverlayPreference } from '../overlay-preferences';
import { resolveWorkspaceRoot } from '../workspace-root';

interface AgentEnvironment {
  name: string;
  path: string;
  install_path: string;
  install_kind: 'toml_command' | 'skills_namespace';
  cleanup_paths?: string[];
}

type InstallScope = 'global' | 'local' | 'both' | 'skip';
type AgentScope = 'project' | 'global';

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

const AGENT_SELECTION_ORDER = ['claude', 'codex', 'gemini', 'cursor', 'opencode'];
const SELECT_ALL_AGENTS_VALUE = '__all_agents__';

export interface SetupOptions {
  json?: boolean;
  quiet?: boolean;
}

export interface RefreshInstalledSkillsOptions {
  cwd?: string;
  homeDir?: string;
  sourceSkillsDir?: string;
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
        verified?: boolean;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export type RefreshInstalledSkillsResult =
  | {
      ok: true;
      data: {
        scope: InstallScope;
        agents: AgentEnvironment[];
        verified: true;
        refreshed: boolean;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

interface VerificationIssue {
  code: string;
  message: string;
}

const SETUP_BANNER = `
 ____  _   _ ____  _____ ____  ____  _        _    _   _
/ ___|| | | |  _ \\| ____|  _ \\|  _ \\| |      / \\  | \\ | |
\\___ \\| | | | |_) |  _| | |_) | |_) | |     / _ \\ |  \\| |
 ___) | |_| |  __/| |___|  _ <|  __/| |___ / ___ \\| |\\  |
|____/ \\___/|_|   |_____|_| \\_\\_|   |_____/_/   \\_\\_| \\_|

`;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasAtLeastOneFile(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory() && await directoryHasAtLeastOneFile(entryPath)) {
        return true;
      }
    }

    return false;
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

async function installSkillsNamespace(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  // Remove the legacy bundled Superplan skill entry before installing peer skills.
  await fs.rm(path.join(targetDir, 'superplan'), { recursive: true, force: true });

  for (const entry of entries) {
    if (entry.name === 'SKILL.md') {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    await fs.rm(targetPath, { recursive: true, force: true });

    try {
      await fs.symlink(sourcePath, targetPath, entry.isDirectory() ? 'dir' : 'file');
    } catch {
      if (entry.isDirectory()) {
        await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
      } else {
        await fs.copyFile(sourcePath, targetPath);
      }
    }
  }
}

function getGeminiCommandContent(): string {
  return `description = "Use Superplan as the task execution control plane for this repository"

prompt = """
Use the Superplan CLI in this repository as the source of truth for task state.

Common commands:
- \`superplan status --json\`
- \`superplan run --json\`
- \`superplan task why-next --json\`
- \`superplan task show <task_id> --json\`
- \`superplan task block <task_id> --reason "<reason>" --json\`
- \`superplan task request-feedback <task_id> --message "<message>" --json\`
- \`superplan task complete <task_id> --json\`
- \`superplan task fix --json\`
- \`superplan doctor --json\`
- \`superplan overlay ensure --json\`
- \`superplan overlay hide --json\`

Execution loop:
1. Check \`superplan status --json\`
2. Claim work with \`superplan run --json\`
3. Inspect the selected task before editing code
4. Update runtime state with block, feedback, complete, or fix commands instead of editing markdown state by hand
5. If overlay support is enabled for this workspace, task start/resume/run transitions will auto-reveal the overlay when work becomes active; on a fresh machine or after install/update, verify overlay health with \`superplan doctor --json\` and \`superplan overlay ensure --json\` before assuming it is working, and inspect launchability or companion errors if the reveal fails; use \`superplan overlay hide --json\` when it becomes idle or empty

Never write \`.superplan/runtime/overlay.json\` by hand.
"""`;
}

function getAgentDisplayName(agent: AgentEnvironment): string {
  return AGENT_DISPLAY_NAMES[agent.name] ?? agent.name;
}

function sortAgentsForSelection(agents: AgentEnvironment[]): AgentEnvironment[] {
  return [...agents].sort((left, right) => {
    const leftIndex = AGENT_SELECTION_ORDER.indexOf(left.name);
    const rightIndex = AGENT_SELECTION_ORDER.indexOf(right.name);
    const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

    if (normalizedLeftIndex !== normalizedRightIndex) {
      return normalizedLeftIndex - normalizedRightIndex;
    }

    return getAgentDisplayName(left).localeCompare(getAgentDisplayName(right));
  });
}

function formatDetectedAgentInstructions(agents: AgentEnvironment[]): string {
  const foundAgentNames = agents.map(getAgentDisplayName).join(', ');
  return `\n! Found: ${foundAgentNames}\n! Space = select, Enter = continue`;
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
    if (agent.install_kind === 'skills_namespace') {
      await installSkillsNamespace(skillsDir, agent.install_path);

      for (const cleanupPath of agent.cleanup_paths ?? []) {
        await fs.rm(cleanupPath, { recursive: true, force: true });
      }

      continue;
    }

    await fs.mkdir(path.dirname(agent.install_path), { recursive: true });
    await fs.writeFile(agent.install_path, getGeminiCommandContent(), 'utf-8');
  }
}

async function promptForAgentSelection(
  message: string,
  detectedAgents: AgentEnvironment[],
): Promise<AgentEnvironment[]> {
  const orderedAgents = sortAgentsForSelection(detectedAgents);
  if (orderedAgents.length === 0) {
    return [];
  }

  const selectedAgentNames = new Set(await checkbox<string>({
    message,
    required: true,
    instructions: formatDetectedAgentInstructions(orderedAgents),
    theme: {
      icon: {
        checked: '[x]',
        unchecked: '[ ]',
      },
    },
    validate: choices => choices.length > 0 || 'Select at least one agent integration to continue.',
    choices: [
      ...orderedAgents.map(agent => ({
        name: getAgentDisplayName(agent),
        value: agent.name,
        checked: false,
      })),
      ...(orderedAgents.length > 1
        ? [{
            name: 'Select all found AI agents',
            value: SELECT_ALL_AGENTS_VALUE,
            checked: false,
          }]
        : []),
    ],
  }));

  if (selectedAgentNames.has(SELECT_ALL_AGENTS_VALUE)) {
    return orderedAgents;
  }

  return orderedAgents.filter(agent => selectedAgentNames.has(agent.name));
}

async function ensureSkillsSource(
  sourceDir: string,
): Promise<{ ok: false; error: { code: string; message: string; retryable: boolean } } | null> {
  try {
    const stats = await fs.stat(sourceDir);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        error: {
          code: 'SKILLS_SOURCE_MISSING',
          message: 'Bundled skills folder not found in CLI package',
          retryable: false,
        },
      };
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'SKILLS_SOURCE_MISSING',
        message: 'Bundled skills folder not found in CLI package',
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

function getAgentVerificationPath(agent: AgentEnvironment): string {
  if (agent.install_kind === 'skills_namespace') {
    return path.join(agent.install_path, 'using-superplan', 'SKILL.md');
  }

  return agent.install_path;
}

async function verifySetup(scope: InstallScope, paths: {
  globalConfigPath: string;
  globalSkillsDir: string;
  localConfigPath: string;
  localSkillsDir: string;
  localChangesDir: string;
  homeAgents: AgentEnvironment[];
  repoAgents: AgentEnvironment[];
}): Promise<VerificationIssue[]> {
  const issues: VerificationIssue[] = [];

  if (scope === 'global' || scope === 'both') {
    if (!await pathExists(paths.globalConfigPath)) {
      issues.push({
        code: 'GLOBAL_CONFIG_MISSING',
        message: 'Global config was not installed correctly.',
      });
    }

    const globalSkillsInstalled = await pathExists(paths.globalSkillsDir)
      && await directoryHasAtLeastOneFile(paths.globalSkillsDir);
    if (!globalSkillsInstalled) {
      issues.push({
        code: 'GLOBAL_SKILLS_MISSING',
        message: 'Global skills were not installed correctly.',
      });
    }

    for (const agent of paths.homeAgents) {
      if (!await pathExists(getAgentVerificationPath(agent))) {
        issues.push({
          code: 'GLOBAL_AGENT_INSTALL_MISSING',
          message: `Global ${agent.name} integration was not installed correctly.`,
        });
      }
    }
  }

  if (scope === 'local' || scope === 'both') {
    if (!await pathExists(paths.localConfigPath)) {
      issues.push({
        code: 'LOCAL_CONFIG_MISSING',
        message: 'Local config was not installed correctly.',
      });
    }

    const localSkillsInstalled = await pathExists(paths.localSkillsDir)
      && await directoryHasAtLeastOneFile(paths.localSkillsDir);
    if (!localSkillsInstalled) {
      issues.push({
        code: 'LOCAL_SKILLS_MISSING',
        message: 'Local skills were not installed correctly.',
      });
    }

    if (!await pathExists(paths.localChangesDir)) {
      issues.push({
        code: 'LOCAL_CHANGES_MISSING',
        message: 'Local changes directory was not created correctly.',
      });
    }

    for (const agent of paths.repoAgents) {
      if (!await pathExists(getAgentVerificationPath(agent))) {
        issues.push({
          code: 'LOCAL_AGENT_INSTALL_MISSING',
          message: `Local ${agent.name} integration was not installed correctly.`,
        });
      }
    }
  }

  return issues;
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

function printSetupBanner(): void {
  console.log(SETUP_BANNER);
}

export async function refreshInstalledSkills(
  options: RefreshInstalledSkillsOptions = {},
): Promise<RefreshInstalledSkillsResult> {
  try {
    const cwd = options.cwd ?? process.cwd();
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const homeDir = options.homeDir ?? os.homedir();
    const sourceSkillsDir = options.sourceSkillsDir ?? path.resolve(__dirname, '../../skills');

    const globalConfigDir = path.join(homeDir, '.config', 'superplan');
    const globalConfigPath = path.join(globalConfigDir, 'config.toml');
    const globalSkillsDir = path.join(globalConfigDir, 'skills');

    const localSuperplanDir = path.join(workspaceRoot, '.superplan');
    const localConfigPath = path.join(localSuperplanDir, 'config.toml');
    const localSkillsDir = path.join(localSuperplanDir, 'skills');
    const localChangesDir = path.join(localSuperplanDir, 'changes');

    const hasGlobalSetup = await pathExists(globalConfigPath) || await pathExists(globalSkillsDir);
    const hasLocalSetup = await pathExists(localConfigPath) || await pathExists(localSkillsDir);

    const scope: InstallScope = hasGlobalSetup && hasLocalSetup
      ? 'both'
      : hasGlobalSetup
        ? 'global'
        : hasLocalSetup
          ? 'local'
          : 'skip';

    if (scope === 'skip') {
      return {
        ok: true,
        data: {
          scope,
          agents: [],
          verified: true,
          refreshed: false,
        },
      };
    }

    const skillsSourceError = await ensureSkillsSource(sourceSkillsDir);
    if (skillsSourceError) {
      return {
        ok: false,
        error: skillsSourceError.error,
      };
    }

    const repoAgents = scope === 'local' || scope === 'both'
      ? await detectAgents(workspaceRoot, 'project')
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

    const verificationIssues = await verifySetup(scope, {
      globalConfigPath,
      globalSkillsDir,
      localConfigPath,
      localSkillsDir,
      localChangesDir,
      homeAgents,
      repoAgents,
    });

    if (verificationIssues.length > 0) {
      return {
        ok: false,
        error: {
          code: 'SETUP_VERIFICATION_FAILED',
          message: verificationIssues.map(issue => issue.message).join(' '),
          retryable: false,
        },
      };
    }

    return {
      ok: true,
      data: {
        scope,
        agents: [...homeAgents, ...repoAgents],
        verified: true,
        refreshed: true,
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

export async function setup(options: SetupOptions): Promise<SetupResult> {
  try {
    if (options.json && !options.quiet) {
      return {
        ok: false,
        error: {
          code: 'INTERACTIVE_REQUIRED',
          message: 'setup must be run interactively',
          retryable: false,
        },
      };
    }

    if (!options.quiet) {
      printSetupBanner();
    }

    const cwd = process.cwd();
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const homeDir = os.homedir();
    const sourceSkillsDir = path.resolve(__dirname, '../../skills');

    const globalConfigDir = path.join(homeDir, '.config', 'superplan');
    const globalConfigPath = path.join(globalConfigDir, 'config.toml');
    const globalSkillsDir = path.join(globalConfigDir, 'skills');

    const localSuperplanDir = path.join(workspaceRoot, '.superplan');
    const localConfigPath = path.join(localSuperplanDir, 'config.toml');
    const localSkillsDir = path.join(localSuperplanDir, 'skills');
    const localChangesDir = path.join(localSuperplanDir, 'changes');

    const alreadySetup = await pathExists(globalConfigPath) || await pathExists(localSuperplanDir);
    if (alreadySetup && !options.quiet) {
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

    const scope = options.quiet
      ? 'global'
      : await select<InstallScope>({
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

    const enableGlobalOverlay = options.quiet
      ? false
      : ((scope === 'global' || scope === 'both')
        ? await confirm({ message: 'Enable desktop overlay by default on this machine?' })
        : false);
    const enableLocalOverlay = options.quiet
      ? false
      : ((scope === 'local' || scope === 'both')
        ? await confirm({ message: 'Enable desktop overlay in this repository?' })
        : false);

    const skillsSourceError = await ensureSkillsSource(sourceSkillsDir);
    if (skillsSourceError) {
      return skillsSourceError;
    }

    const detectedRepoAgents = scope === 'local' || scope === 'both'
      ? await detectAgents(workspaceRoot, 'project')
      : [];
    const detectedHomeAgents = scope === 'global' || scope === 'both'
      ? await detectAgents(homeDir, 'global')
      : [];
    const homeAgents = scope === 'global' || scope === 'both'
      ? (options.quiet
        ? detectedHomeAgents
        : await promptForAgentSelection(
          'Select machine-level AI agents',
          detectedHomeAgents,
        ))
      : [];
    const repoAgents = scope === 'local' || scope === 'both'
      ? (options.quiet
        ? detectedRepoAgents
        : await promptForAgentSelection(
          scope === 'both'
            ? 'Select repository AI agents'
            : 'Select AI agents in this repository',
          detectedRepoAgents,
        ))
      : [];

    if (scope === 'global' || scope === 'both') {
      await ensureGlobalSetup(globalConfigDir, globalConfigPath, globalSkillsDir, sourceSkillsDir);
      await writeOverlayPreference(enableGlobalOverlay, { scope: 'global', cwd });
      if (homeAgents.length > 0) {
        await installAgentSkills(globalSkillsDir, homeAgents);
      }
    }

    if (scope === 'local' || scope === 'both') {
      await ensureLocalSetup(localSuperplanDir, localConfigPath, localSkillsDir, localChangesDir, sourceSkillsDir);
      await writeOverlayPreference(enableLocalOverlay, { scope: 'local', cwd: workspaceRoot });
      if (repoAgents.length > 0) {
        await installAgentSkills(localSkillsDir, repoAgents);
      }
    }

    const verificationIssues = await verifySetup(scope, {
      globalConfigPath,
      globalSkillsDir,
      localConfigPath,
      localSkillsDir,
      localChangesDir,
      homeAgents,
      repoAgents,
    });
    if (verificationIssues.length > 0) {
      return {
        ok: false,
        error: {
          code: 'SETUP_VERIFICATION_FAILED',
          message: verificationIssues.map(issue => issue.message).join(' '),
          retryable: false,
        },
      };
    }

    const installedAgents = [...homeAgents, ...repoAgents];
    const noAgentsMessage = installedAgents.length === 0
      ? (options.quiet ? getNoAgentsMessage(scope, installedAgents.length) : 'No agent integrations selected.')
      : undefined;
    const quietMessage = options.quiet ? ' Quiet mode used default scope: global.' : '';
    const message = noAgentsMessage
      ? `${noAgentsMessage} Setup verification passed.${quietMessage}`
      : `Setup verification passed.${quietMessage}`;

    return {
      ok: true,
      data: {
        ...getScopePaths(scope, globalConfigPath, globalSkillsDir, localConfigPath, localSkillsDir),
        scope,
        agents: installedAgents,
        verified: true,
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
