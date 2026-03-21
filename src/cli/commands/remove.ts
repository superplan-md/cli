import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { confirm, select } from '@inquirer/prompts';
import { readInstallMetadata, type InstallMetadata } from '../install-metadata';
import { ALL_SUPERPLAN_SKILL_NAMES } from '../skill-names';

interface AgentEnvironment {
  name: string;
  path: string;
  install_path: string;
  install_kind: 'toml_command' | 'skills_namespace';
  cleanup_paths?: string[];
}

type RemoveScope = 'global' | 'local' | 'both' | 'skip';
type AgentScope = 'project' | 'global';

export interface RemoveOptions {
  json?: boolean;
  quiet?: boolean;
  scope?: RemoveScope;
  yes?: boolean;
}

interface RemoveDeps {
  readInstallMetadata?: () => Promise<InstallMetadata | null>;
  currentPackageRoot?: string;
  invokedEntryPath?: string;
}

export type RemoveResult =
  | {
      ok: true;
      data: {
        scope: RemoveScope;
        mode: 'remove';
        removed_paths: string[];
        agents: AgentEnvironment[];
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function getOptionValue(args: string[], optionName: string): string | undefined {
  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) {
    return undefined;
  }

  const optionValue = args[optionIndex + 1];
  if (!optionValue || optionValue.startsWith('--')) {
    return undefined;
  }

  return optionValue;
}

function isRemoveScope(value: string | undefined): value is RemoveScope {
  return value === 'global' || value === 'local' || value === 'both' || value === 'skip';
}

export function getRemoveCommandHelpMessage(invalidScope?: string): string {
  const intro = invalidScope
    ? `Invalid remove scope: ${invalidScope}`
    : 'Remove deletes Superplan installation and state.';

  return [
    intro,
    '',
    'Usage:',
    '  superplan remove --scope <local|global|both|skip> --yes --json',
    '  superplan remove                 # interactive mode',
    '',
    'Options:',
    '  --scope <scope>   local, global, both, or skip',
    '  --yes             confirm the destructive action without a prompt',
    '  --json            return structured output',
    '',
    'Examples:',
    '  superplan remove --scope local --yes --json',
    '  superplan remove --scope global --yes --json',
  ].join('\n');
}

function getInvalidRemoveCommandError(message: string): RemoveResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_REMOVE_COMMAND',
      message,
      retryable: false,
    },
  };
}

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
  return [...new Set([
    ...entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name),
    ...ALL_SUPERPLAN_SKILL_NAMES,
  ])]
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

async function findNearestProjectRoot(startDir: string, managedSkillNames: string[]): Promise<string> {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (await pathExists(path.join(currentDir, '.superplan'))) {
      return currentDir;
    }

    const detectedAgents = await detectAgents(currentDir, 'project', managedSkillNames);
    if (detectedAgents.length > 0) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(startDir);
    }

    currentDir = parentDir;
  }
}

async function removePath(targetPath: string, removedPaths: string[]): Promise<void> {
  if (!targetPath) {
    return;
  }

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

function inferInstalledCliTargetsFromPackageRoot(packageRoot: string): string[] {
  const normalizedRoot = path.normalize(packageRoot);
  if (path.basename(normalizedRoot) !== 'superplan') {
    return [];
  }

  const nodeModulesDir = path.dirname(normalizedRoot);
  if (path.basename(nodeModulesDir) !== 'node_modules') {
    return [];
  }

  const libDir = path.dirname(nodeModulesDir);
  if (path.basename(libDir) !== 'lib') {
    return [];
  }

  const installPrefix = path.dirname(libDir);
  return [
    normalizedRoot,
    path.join(installPrefix, 'bin', 'superplan'),
  ];
}

function inferInstalledCliTargetsFromInvokedEntryPath(invokedEntryPath: string): string[] {
  const normalizedEntryPath = path.normalize(invokedEntryPath);
  if (path.basename(normalizedEntryPath) !== 'superplan') {
    return [];
  }

  const binDir = path.dirname(normalizedEntryPath);
  if (path.basename(binDir) !== 'bin') {
    return [];
  }

  const installPrefix = path.dirname(binDir);
  return [
    path.join(installPrefix, 'lib', 'node_modules', 'superplan'),
    normalizedEntryPath,
  ];
}

function resolveInstalledCliTargets(
  installMetadata: InstallMetadata | null,
  currentPackageRoot: string,
  invokedEntryPath: string,
): string[] {
  const targets = new Set<string>();

  if (installMetadata?.install_bin) {
    targets.add(path.join(installMetadata.install_bin, 'superplan'));
  }

  if (installMetadata?.install_prefix) {
    targets.add(path.join(installMetadata.install_prefix, 'lib', 'node_modules', 'superplan'));
  }

  for (const inferredTarget of inferInstalledCliTargetsFromPackageRoot(currentPackageRoot)) {
    targets.add(inferredTarget);
  }

  for (const inferredTarget of inferInstalledCliTargetsFromInvokedEntryPath(invokedEntryPath)) {
    targets.add(inferredTarget);
  }

  return Array.from(targets);
}

async function removeCommand(
  options: RemoveOptions,
  deps: Partial<RemoveDeps> = {},
): Promise<RemoveResult> {
  try {
    const nonInteractive = Boolean(options.json || options.quiet);
    const cwd = process.cwd();
    const homeDir = os.homedir();
    const sourceSkillsDir = path.resolve(__dirname, '../../skills');
    const managedSkillNames = await getManagedSkillNames(sourceSkillsDir);
    const localRootDir = await findNearestProjectRoot(cwd, managedSkillNames);

    const globalSuperplanDir = path.join(homeDir, '.config', 'superplan');
    const localSuperplanDir = path.join(localRootDir, '.superplan');

    let scope = options.scope;
    if (!scope) {
      if (nonInteractive) {
        return getInvalidRemoveCommandError([
          'Remove requires --scope in non-interactive mode.',
          '',
          getRemoveCommandHelpMessage(),
        ].join('\n'));
      }

      scope = await select<RemoveScope>({
        message: 'Where do you want to remove Superplan?',
        choices: [
          { name: 'Global (machine-level)', value: 'global' },
          { name: 'Local (current repository)', value: 'local' },
          { name: 'Both', value: 'both' },
          { name: 'Skip', value: 'skip' },
        ],
      });
    }

    if (scope === 'skip') {
      return {
        ok: true,
        data: {
          scope,
          mode: 'remove',
          removed_paths: [],
          agents: [],
        },
      };
    }

    if (!options.yes) {
      if (nonInteractive) {
        return getInvalidRemoveCommandError([
          'Remove requires --yes in non-interactive mode.',
          '',
          getRemoveCommandHelpMessage(),
        ].join('\n'));
      }

      const proceed = await confirm({ message: 'Proceed with remove?' });
      if (!proceed) {
        return {
          ok: false,
          error: {
            code: 'USER_ABORTED',
            message: 'remove aborted by user',
            retryable: false,
          },
        };
      }
    }

    const removedPaths: string[] = [];
    const installMetadataReader = deps.readInstallMetadata ?? readInstallMetadata;
    const installMetadata = await installMetadataReader();
    const installedCliTargets = resolveInstalledCliTargets(
      installMetadata,
      deps.currentPackageRoot ?? path.resolve(__dirname, '../../..'),
      deps.invokedEntryPath ?? process.argv[1] ?? '',
    );
    const globalAgents = scope === 'global' || scope === 'both'
      ? await detectAgents(homeDir, 'global', managedSkillNames)
      : [];
    const localAgents = scope === 'local' || scope === 'both'
      ? await detectAgents(localRootDir, 'project', managedSkillNames)
      : [];

    if (scope === 'global' || scope === 'both') {
      await removeAgentInstalls(globalAgents, managedSkillNames, removedPaths);
      for (const installedCliTarget of installedCliTargets) {
        await removePath(installedCliTarget, removedPaths);
      }
      await removePath(installMetadata?.overlay?.install_path ?? '', removedPaths);
      await removePath(globalSuperplanDir, removedPaths);
    }

    if (scope === 'local' || scope === 'both') {
      await removeAgentInstalls(localAgents, managedSkillNames, removedPaths);
      await removePath(localSuperplanDir, removedPaths);
    }

    return {
      ok: true,
      data: {
        scope,
        mode: 'remove',
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

export async function remove(options: RemoveOptions, deps: Partial<RemoveDeps> = {}): Promise<RemoveResult> {
  return removeCommand(options, deps);
}

export async function removeCli(
  args: string[],
  options: RemoveOptions,
  deps: Partial<RemoveDeps> = {},
): Promise<RemoveResult> {
  const rawScope = getOptionValue(args, '--scope');
  if (rawScope && !isRemoveScope(rawScope)) {
    return getInvalidRemoveCommandError(getRemoveCommandHelpMessage(rawScope));
  }
  const scope = rawScope as RemoveScope | undefined;

  return removeCommand({
    ...options,
    ...(scope ? { scope } : {}),
    yes: args.includes('--yes'),
  }, deps);
}
