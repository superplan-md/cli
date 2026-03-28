import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { confirm } from '@inquirer/prompts';
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

type AgentScope = 'project' | 'global';

const MANAGED_ANTIGRAVITY_BLOCK_START = '<!-- superplan-antigravity:start -->';
const MANAGED_ANTIGRAVITY_BLOCK_END = '<!-- superplan-antigravity:end -->';
const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START = '<!-- superplan-entry-instructions:start -->';
const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END = '<!-- superplan-entry-instructions:end -->';
const MANAGED_AMAZONQ_MEMORY_BANK_START = '<!-- superplan-amazonq-memory-bank:start -->';
const MANAGED_AMAZONQ_MEMORY_BANK_END = '<!-- superplan-amazonq-memory-bank:end -->';

export interface UninstallOptions {
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
}

interface UninstallDeps {
  readInstallMetadata?: () => Promise<InstallMetadata | null>;
  currentPackageRoot?: string;
  invokedEntryPath?: string;
}

export type UninstallResult =
  | {
      ok: true;
      data: {
        mode: 'uninstall';
        removed_paths: string[];
        agents: AgentEnvironment[];
        cli_removed: boolean;
        overlay_removed: boolean;
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

export function getUninstallCommandHelpMessage(): string {
  return [
    'Completely uninstall Superplan including CLI, skills, and overlay.',
    '',
    'This removes Superplan completely from your system.',
    'Use "superplan remove" if you want to keep the CLI.',
    '',
    'Usage:',
    '  superplan uninstall --yes --json',
    '  superplan uninstall              # interactive mode',
    '',
    'Options:',
    '  --yes             confirm the destructive action without a prompt',
    '  --json            return structured output',
    '',
    'Examples:',
    '  superplan uninstall --yes --json',
  ].join('\n');
}

function getInvalidUninstallCommandError(message: string): UninstallResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_UNINSTALL_COMMAND',
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
        name: 'antigravity',
        path: path.join(baseDir, '.agents'),
        install_path: path.join(baseDir, '.agents', 'rules', 'superplan-entry.md'),
        install_kind: 'markdown_rule',
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
      continue;
    }

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

function resolveInstalledOverlayTargets(installMetadata: InstallMetadata | null): string[] {
  const targets = new Set<string>();
  const overlay = installMetadata?.overlay;

  if (overlay?.install_path) {
    targets.add(path.normalize(overlay.install_path));
  }

  if (overlay?.executable_path) {
    targets.add(path.normalize(overlay.executable_path));
  }

  // Standard macOS bundle location if not in metadata or if we want to be thorough
  if (process.platform === 'darwin') {
    targets.add('/Applications/Superplan Overlay Desktop.app');
  }

  return Array.from(targets);
}

async function uninstallCommand(
  options: UninstallOptions,
  deps: Partial<UninstallDeps> = {},
): Promise<UninstallResult> {
  try {
    const nonInteractive = Boolean(options.json || options.quiet);
    const cwd = process.cwd();
    const homeDir = os.homedir();
    const sourceSkillsDir = path.resolve(__dirname, '../../skills');
    const managedSkillNames = await getManagedSkillNames(sourceSkillsDir);
    const localRootDir = await findNearestProjectRoot(cwd, managedSkillNames);

    const globalSuperplanDir = path.join(homeDir, '.config', 'superplan');
    const localSuperplanDir = path.join(localRootDir, '.superplan');

    if (!options.yes) {
      if (nonInteractive) {
        return getInvalidUninstallCommandError([
          'Uninstall requires --yes in non-interactive mode.',
          '',
          getUninstallCommandHelpMessage(),
        ].join('\n'));
      }

      const proceed = await confirm({ 
        message: 'This will completely remove Superplan including the CLI. Proceed?' 
      });
      if (!proceed) {
        return {
          ok: false,
          error: {
            code: 'USER_ABORTED',
            message: 'uninstall aborted by user',
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
    
    // Get all agents (both global and local)
    const globalAgents = await detectAgents(homeDir, 'global', managedSkillNames);
    const localAgents = await detectAgents(localRootDir, 'project', managedSkillNames);

    // Terminate overlay companion
    await terminateInstalledOverlayCompanion();
    await terminateInstalledOverlayCompanion(localRootDir);

    // Handle global uninstall
    // Get installed agents from registry
    const installedAgents = await getInstalledAgentsFromRegistry();
    const allGlobalAgentDefs = getAgentDefinitions(homeDir, 'global');
    const agentsToRemove = allGlobalAgentDefs.filter(agent => 
      installedAgents.includes(agent.name)
    );
    
    // Remove agent skills
    await removeAgentInstalls(agentsToRemove, managedSkillNames, removedPaths);
    
    // Clear registry
    if (agentsToRemove.length > 0) {
      await removeAgentsFromRegistry(agentsToRemove.map(a => a.name));
    }
    
    // Remove managed instruction files
    await removeManagedInstructionsFile(path.join(homeDir, 'AGENTS.md'), removedPaths);
    await removeManagedInstructionsFile(path.join(homeDir, 'CLAUDE.md'), removedPaths);
    await removeManagedInstructionsFile(path.join(homeDir, '.claude', 'CLAUDE.md'), removedPaths);
    await removeManagedInstructionsFile(path.join(homeDir, '.codex', 'AGENTS.md'), removedPaths);
    
    // Remove CLI binaries
    for (const installedCliTarget of installedCliTargets) {
      await removePath(installedCliTarget, removedPaths);
    }
    
    // Remove overlay application
    for (const installedOverlayTarget of installedOverlayTargets) {
      await removePath(installedOverlayTarget, removedPaths);
    }
    
    // Remove global config directory
    await removePath(globalSuperplanDir, removedPaths);
    
    // Clean up overlay application support files on macOS
    if (process.platform === 'darwin') {
      const appSupportDir = path.join(homeDir, 'Library', 'Application Support');
      await removePath(path.join(appSupportDir, 'superplan-overlay-desktop'), removedPaths);
      await removePath(path.join(appSupportDir, 'Superplan Overlay Desktop'), removedPaths);
      await removePath(path.join(appSupportDir, 'com.superplan.overlay'), removedPaths);
    }

    // Handle local uninstall
    await removeAgentInstalls(localAgents, managedSkillNames, removedPaths);
    
    if (localAgents.length > 0) {
      await removeAgentsFromRegistry(localAgents.map(a => a.name));
    }
    
    await removeManagedInstructionsFile(path.join(localRootDir, 'AGENTS.md'), removedPaths);
    await removeManagedInstructionsFile(path.join(localRootDir, 'CLAUDE.md'), removedPaths);
    await removePath(localSuperplanDir, removedPaths);

    const cliRemoved = installedCliTargets.length > 0;
    const overlayRemoved = installedOverlayTargets.length > 0;

    return {
      ok: true,
      data: {
        mode: 'uninstall',
        removed_paths: removedPaths,
        agents: [...globalAgents, ...localAgents],
        cli_removed: cliRemoved,
        overlay_removed: overlayRemoved,
        message: `Superplan completely uninstalled. ${removedPaths.length} paths cleaned up.`,
        next_action: stopNextAction(
          'Superplan has been completely removed from your system.',
          'To use Superplan again, you will need to reinstall it.',
        ),
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'UNINSTALL_FAILED',
        message: error.message || 'An unknown error occurred',
        retryable: false,
      },
    };
  }
}

export async function uninstall(options: UninstallOptions, deps: Partial<UninstallDeps> = {}): Promise<UninstallResult> {
  return uninstallCommand(options, deps);
}

export async function uninstallCli(
  args: string[],
  options: UninstallOptions,
  deps: Partial<UninstallDeps> = {},
): Promise<UninstallResult> {
  return uninstallCommand({
    ...options,
    yes: args.includes('--yes'),
  }, deps);
}
