import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { confirm, select } from '@inquirer/prompts';
import { AgentInstallKind } from '../agent-integrations';
import { readInstallMetadata, type InstallMetadata } from '../install-metadata';
import { ALL_SUPERPLAN_SKILL_NAMES } from '../skill-names';
import { stopNextAction, type NextAction } from '../next-action';
import { terminateInstalledOverlayCompanion } from '../overlay-companion';
import { removeAgentsFromRegistry, getInstalledAgentsFromRegistry } from '../global-superplan';

interface AgentEnvironment {
  name: string;
  path: string;
  install_path: string;
  install_kind: AgentInstallKind;
  cleanup_paths?: string[];
}

type RemoveScope = 'global' | 'local' | 'skip';
type AgentScope = 'project' | 'global';

const MANAGED_ANTIGRAVITY_BLOCK_START = '<!-- superplan-antigravity:start -->';
const MANAGED_ANTIGRAVITY_BLOCK_END = '<!-- superplan-antigravity:end -->';
const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START = '<!-- superplan-entry-instructions:start -->';
const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END = '<!-- superplan-entry-instructions:end -->';
const MANAGED_AMAZONQ_MEMORY_BANK_START = '<!-- superplan-amazonq-memory-bank:start -->';
const MANAGED_AMAZONQ_MEMORY_BANK_END = '<!-- superplan-amazonq-memory-bank:end -->';

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
        message: string;
        next_action: NextAction;
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
  return value === 'global' || value === 'local' || value === 'skip';
}

export function getRemoveCommandHelpMessage(invalidScope?: string): string {
  const intro = invalidScope
    ? `Invalid remove scope: ${invalidScope}`
    : 'Remove Superplan skills and configuration from agent directories.';

  return [
    intro,
    '',
    'This removes Superplan skills from agent directories but keeps the CLI installed.',
    'Use "superplan uninstall" to completely remove Superplan including the CLI.',
    '',
    'Usage:',
    '  superplan remove --scope <local|global|skip> --yes --json',
    '  superplan remove                 # interactive mode',
    '',
    'Options:',
    '  --scope <scope>   local, global, or skip',
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
      {
        name: 'amazonq',
        path: path.join(baseDir, '.amazonq'),
        install_path: path.join(baseDir, '.amazonq', 'rules'),
        install_kind: 'amazonq_rules',
        cleanup_paths: [path.join(baseDir, '.amazonq', 'rules', 'superplan')],
      },
      {
        name: 'copilot',
        path: path.join(baseDir, '.github'),
        install_path: path.join(baseDir, '.github', 'skills'),
        install_kind: 'skills_namespace',
        cleanup_paths: [path.join(baseDir, '.github', 'copilot-instructions.md')],
      },
      {
        name: 'antigravity',
        path: path.join(baseDir, '.agents'),
        install_path: path.join(baseDir, '.agents', 'workflows'),
        install_kind: 'antigravity_workflows',
        cleanup_paths: [
          path.join(baseDir, '.agents', 'rules', 'superplan-entry.md'),
          path.join(baseDir, '.agents'),
        ],
      },
      {
        name: 'windsurf',
        path: path.join(baseDir, '.windsurf'),
        install_path: path.join(baseDir, '.windsurf', 'workflows'),
        install_kind: 'windsurf_rules',
        cleanup_paths: [
          path.join(baseDir, '.windsurf', 'skills'),
          path.join(baseDir, '.windsurf', 'rules'),
          path.join(baseDir, '.windsurfrules'),
        ],
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
    {
      name: 'antigravity',
      path: path.join(baseDir, '.gemini'),
      install_path: path.join(baseDir, '.gemini', 'GEMINI.md'),
      install_kind: 'managed_global_rule',
    },
    {
      name: 'windsurf',
      path: path.join(baseDir, '.windsurf'),
      install_path: path.join(baseDir, '.windsurf', 'workflows'),
      install_kind: 'windsurf_rules',
      cleanup_paths: [
        path.join(baseDir, '.windsurf', 'skills'),
        path.join(baseDir, '.windsurf', 'rules'),
        path.join(baseDir, '.windsurfrules'),
      ],
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

  if (agent.install_kind === 'amazonq_rules') {
    return [
      ...managedSkillNames.map(skillName => path.join(agent.install_path, `${skillName}.md`)),
      path.join(agent.install_path, 'memory-bank', 'product.md'),
      path.join(agent.install_path, 'memory-bank', 'guidelines.md'),
      path.join(agent.install_path, 'memory-bank', 'tech.md'),
      ...(agent.cleanup_paths ?? []),
    ];
  }

  if (agent.install_kind === 'windsurf_rules') {
    return [
      ...managedSkillNames.map(skillName => path.join(agent.install_path, `${skillName}.md`)),
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
    // Check if agent's base directory exists (e.g., .cursor/, .agents/)
    const baseDirExists = await pathExists(agent.path);
    
    if (baseDirExists) {
      detectedAgents.push(agent);
      continue;
    }
    
    // Fallback: check managed install paths
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

async function removePathIfEmpty(targetPath: string, removedPaths: string[]): Promise<void> {
  if (!targetPath || !await pathExists(targetPath)) {
    return;
  }

  let stats;
  try {
    stats = await fs.stat(targetPath);
  } catch {
    return;
  }

  if (!stats.isDirectory()) {
    return;
  }

  const entries = await fs.readdir(targetPath);
  if (entries.length > 0) {
    return;
  }

  await fs.rmdir(targetPath);
  removedPaths.push(targetPath);
}

function stripManagedAntigravityBlock(content: string): string {
  return content
    .replace(new RegExp(`\\n?${MANAGED_ANTIGRAVITY_BLOCK_START}[\\s\\S]*?${MANAGED_ANTIGRAVITY_BLOCK_END}\\n?`, 'm'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function stripManagedEntryInstructionsBlock(content: string): string {
  return content
    .replace(new RegExp(`\\n?${MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START}[\\s\\S]*?${MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END}\\n?`, 'm'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function stripManagedAmazonQMemoryBankBlock(content: string): string {
  return content
    .replace(new RegExp(`\\n?${MANAGED_AMAZONQ_MEMORY_BANK_START}[\\s\\S]*?${MANAGED_AMAZONQ_MEMORY_BANK_END}\\n?`, 'm'), '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

async function removeManagedGlobalRule(targetPath: string, removedPaths: string[]): Promise<void> {
  if (!await pathExists(targetPath)) {
    return;
  }

  const existingContent = await fs.readFile(targetPath, 'utf-8');
  const nextContent = stripManagedAntigravityBlock(existingContent);
  if (nextContent === existingContent) {
    return;
  }

  if (!nextContent.trim()) {
    await fs.rm(targetPath, { force: true });
  } else {
    await fs.writeFile(targetPath, `${nextContent}\n`, 'utf-8');
  }

  removedPaths.push(targetPath);
}

async function removeManagedInstructionsFile(targetPath: string, removedPaths: string[]): Promise<void> {
  if (!await pathExists(targetPath)) {
    return;
  }

  const existingContent = await fs.readFile(targetPath, 'utf-8');
  const nextContent = stripManagedEntryInstructionsBlock(existingContent);
  if (nextContent === existingContent) {
    return;
  }

  if (!nextContent.trim()) {
    await fs.rm(targetPath, { force: true });
  } else {
    await fs.writeFile(targetPath, `${nextContent}\n`, 'utf-8');
  }

  removedPaths.push(targetPath);
}

async function removeManagedAmazonQMemoryBankFile(targetPath: string, removedPaths: string[]): Promise<void> {
  if (!await pathExists(targetPath)) {
    return;
  }

  const existingContent = await fs.readFile(targetPath, 'utf-8');
  const nextContent = stripManagedAmazonQMemoryBankBlock(existingContent);
  if (nextContent === existingContent) {
    return;
  }

  if (!nextContent.trim()) {
    await fs.rm(targetPath, { force: true });
  } else {
    await fs.writeFile(targetPath, `${nextContent}\n`, 'utf-8');
  }

  removedPaths.push(targetPath);
}

async function removeAgentInstalls(
  agents: AgentEnvironment[],
  managedSkillNames: string[],
  removedPaths: string[],
): Promise<void> {
  for (const agent of agents) {
    if (agent.install_kind === 'managed_global_rule') {
      await removeManagedGlobalRule(agent.install_path, removedPaths);
      continue;
    }

    if (agent.install_kind === 'amazonq_rules') {
      for (const managedSkillName of managedSkillNames) {
        await removePath(path.join(agent.install_path, `${managedSkillName}.md`), removedPaths);
      }
      for (const fileName of ['product.md', 'guidelines.md', 'tech.md']) {
        await removeManagedAmazonQMemoryBankFile(path.join(agent.install_path, 'memory-bank', fileName), removedPaths);
      }
      for (const cleanupPath of agent.cleanup_paths ?? []) {
        await removePath(cleanupPath, removedPaths);
      }
      await removePathIfEmpty(agent.path, removedPaths);
      continue;
    }

    if (agent.install_kind === 'antigravity_workflows') {
      // Remove workflows directory and any cleanup paths (including .agents/)
      await removePath(agent.install_path, removedPaths);
      for (const cleanupPath of agent.cleanup_paths ?? []) {
        await removePath(cleanupPath, removedPaths);
      }
      continue;
    }

    if (agent.install_kind === 'windsurf_rules') {
      // Remove windsurf rules directory
      for (const managedSkillName of managedSkillNames) {
        await removePath(path.join(agent.install_path, `${managedSkillName}.md`), removedPaths);
      }
      for (const cleanupPath of agent.cleanup_paths ?? []) {
        await removePath(cleanupPath, removedPaths);
      }
      await removePathIfEmpty(agent.path, removedPaths);
      continue;
    }

    for (const managedPath of getManagedInstallPaths(agent, managedSkillNames)) {
      await removePath(managedPath, removedPaths);
    }
    await removePathIfEmpty(agent.path, removedPaths);
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

function resolveInstalledOverlayTargets(installMetadata: InstallMetadata | null): string[] {
  const targets = new Set<string>();
  const overlay = installMetadata?.overlay;

  if (overlay?.install_path) {
    targets.add(path.normalize(overlay.install_path));
  }

  if (overlay?.executable_path) {
    targets.add(path.normalize(overlay.executable_path));
  }

  if (process.platform === 'darwin') {
    targets.add('/Applications/Superplan.app');
    targets.add(path.join(os.homedir(), '.local', 'share', 'superplan', 'overlay', 'Superplan.app'));
    targets.add('/Applications/Superplan Overlay Desktop.app');
  }

  if (process.platform === 'linux') {
    targets.add(path.join(os.homedir(), '.local', 'share', 'superplan', 'overlay', 'superplan-overlay.AppImage'));
  }

  if (process.platform === 'win32') {
    targets.add(path.join(os.homedir(), '.config', 'superplan', 'overlay', 'superplan-overlay.exe'));
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
          { name: 'Global (machine-level and this repository)', value: 'global' },
          { name: 'Local (this repository only)', value: 'local' },
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
          message: 'Removal skipped.',
          next_action: stopNextAction(
            'Removal was skipped; no further Superplan action is required from this command.',
            'The command was explicitly told to skip removal.',
          ),
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
    const installedOverlayTargets = resolveInstalledOverlayTargets(installMetadata);
    const globalAgents = scope === 'global'
      ? await detectAgents(homeDir, 'global', managedSkillNames)
      : [];
    const localAgents = scope === 'local' || scope === 'global'
      ? await detectAgents(localRootDir, 'project', managedSkillNames)
      : [];

    if (scope === 'global') {
      await terminateInstalledOverlayCompanion();
    } else if (scope === 'local') {
      await terminateInstalledOverlayCompanion(localRootDir);
    }

    // For global scope, check agent registry to find which agents have Superplan installed
    if (scope === 'global') {
      const installedAgents = await getInstalledAgentsFromRegistry();
      
      // Get agent definitions for all globally installed agents
      const allGlobalAgentDefs = getAgentDefinitions(homeDir, 'global');
      const agentsToRemove = allGlobalAgentDefs.filter(agent => 
        installedAgents.includes(agent.name)
      );
      
      // Remove agent skills from their directories
      await removeAgentInstalls(agentsToRemove, managedSkillNames, removedPaths);
      
      // Remove agents from registry
      if (agentsToRemove.length > 0) {
        await removeAgentsFromRegistry(agentsToRemove.map(a => a.name));
      }
      
      // Remove global AGENTS.md and CLAUDE.md if they exist
      await removeManagedInstructionsFile(path.join(homeDir, 'AGENTS.md'), removedPaths);
      await removeManagedInstructionsFile(path.join(homeDir, 'CLAUDE.md'), removedPaths);
      await removeManagedInstructionsFile(path.join(homeDir, '.claude', 'CLAUDE.md'), removedPaths);
      await removeManagedInstructionsFile(path.join(homeDir, '.codex', 'AGENTS.md'), removedPaths);

      for (const installedCliTarget of installedCliTargets) {
        await removePath(installedCliTarget, removedPaths);
      }

      for (const installedOverlayTarget of installedOverlayTargets) {
        await removePath(installedOverlayTarget, removedPaths);
      }
      
      // Thoroughly wipe the global config directory
      await removePath(globalSuperplanDir, removedPaths);
    }

    if (scope === 'local' || scope === 'global') {
      // For local scope, remove from project directories
      await removeAgentInstalls(localAgents, managedSkillNames, removedPaths);
      
      // Remove local agents from registry
      if (localAgents.length > 0) {
        await removeAgentsFromRegistry(localAgents.map(a => a.name));
      }
      
      // Remove local instruction files
      await removeManagedInstructionsFile(path.join(localRootDir, 'AGENTS.md'), removedPaths);
      await removeManagedInstructionsFile(path.join(localRootDir, 'CLAUDE.md'), removedPaths);
      await removePath(localSuperplanDir, removedPaths);
    }

    return {
      ok: true,
      data: {
        scope,
        mode: 'remove',
        removed_paths: removedPaths,
        agents: [...globalAgents, ...localAgents],
        message: `Superplan removed from ${scope} scope. ${removedPaths.length} paths cleaned up.`,
        next_action: stopNextAction(
          'Reinstall Superplan with `superplan init` only if you want to use it again in this environment.',
          'Superplan state has been removed, so there is no follow-up workflow command to run now.',
        ),
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
