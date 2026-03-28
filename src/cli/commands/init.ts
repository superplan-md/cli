import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { select, checkbox, confirm } from '@inquirer/prompts';
import {
  installAgentSkills,
  detectAgents,
  ExtendedAgentEnvironment,
  getAgentDisplayName,
  sortAgentsForSelection,
  installManagedInstructionsFile,
  resolveWorkspaceRoot,
  pathExists,
} from './install-helpers';
import { install as runInstall } from './install';
import {
  ensureGlobalWorkspaceArtifacts,
  ensureGlobalChangeArtifacts,
  getGlobalSuperplanPaths,
  hasGlobalSuperplan,
  getInstalledAgentsFromRegistry,
  addAgentsToRegistry,
  isAgentInRegistry,
  getCurrentDirName,
} from '../global-superplan';

export interface InitOptions {
  yes?: boolean;
  quiet?: boolean;
  json?: boolean;
  global?: boolean;
  local?: boolean;
}

export type InitResult =
  | {
      ok: true;
      data: {
        superplan_root: string;
        agents: ExtendedAgentEnvironment[];
        message?: string;
        verified?: boolean;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const SETUP_BANNER = `
 ____  _   _ ____  _____ ____  ____  _        _    _   _
/ ___|| | | |  _ \\| ____|  _ \\|  _ \\| |      / \\  | \\ | |
\\___ \\| | | | |_) |  _| | |_) | |_) | |     / _ \\ |  \\| |
 ___) | |_| |  __/| |___|  _ <|  __/| |___ / ___ \\| |\\  |
|____/ \\___/|_|   |_____|_| \\_\\_|   |_____/_/   \\_\\_| \\_|

`;

function printSetupBanner(): void {
  console.log(SETUP_BANNER);
}

function formatDetectedAgentInstructions(agents: ExtendedAgentEnvironment[]): string {
  const foundAgentNames = agents.map(getAgentDisplayName).join(', ');
  return `\n! Found: ${foundAgentNames}\n! Space = select, Enter = continue`;
}

function hasAgent(agents: ExtendedAgentEnvironment[], name: ExtendedAgentEnvironment['name']): boolean {
  return agents.some(agent => agent.name === name);
}

async function updateGitignoreForLocalInstall(cwd: string, agents: ExtendedAgentEnvironment[]): Promise<void> {
  const gitignorePath = path.join(cwd, '.gitignore');
  
  // Build list of entries based on installed agents
  const entries: string[] = [];
  
  for (const agent of agents) {
    switch (agent.name) {
      case 'claude':
        entries.push('.claude/');
        break;
      case 'cursor':
        entries.push('.cursor/');
        break;
      case 'codex':
        entries.push('.codex/');
        break;
      case 'opencode':
        entries.push('.opencode/');
        break;
      case 'gemini':
        entries.push('.gemini/');
        break;
      case 'amazonq':
        entries.push('.amazonq/');
        break;
      case 'antigravity':
        entries.push('.agents/');
        break;
      case 'copilot':
        entries.push('.github/skills/');
        break;
    }
  }
  
  // Also add root-level files
  if (agents.some(a => a.name === 'claude')) {
    entries.push('CLAUDE.md');
  }
  entries.push('AGENTS.md');
  
  // Remove duplicates and sort
  const uniqueEntries = [...new Set(entries)].sort();
  
  try {
    let content = '';
    try {
      content = await fs.readFile(gitignorePath, 'utf-8');
    } catch {
      // File doesn't exist, will create new
    }
    
    // Filter out entries that already exist
    const newEntries = uniqueEntries.filter(entry => !content.includes(entry));
    
    if (newEntries.length === 0) {
      return; // Nothing to add
    }
    
    // Add Superplan section
    const sectionHeader = '\n# Superplan - AI agent configurations\n';
    const sectionContent = newEntries.join('\n') + '\n';
    
    const newContent = content.endsWith('\n') || content === ''
      ? content + sectionHeader + sectionContent
      : content + '\n' + sectionHeader + sectionContent;
    
    await fs.writeFile(gitignorePath, newContent, 'utf-8');
    
    console.log(`\n✓ Updated .gitignore with ${newEntries.length} entries:`);
    for (const entry of newEntries) {
      console.log(`  - ${entry}`);
    }
  } catch {
    // Ignore errors
  }
}

export function getInitCommandHelpMessage(): string {
  return [
    'Initialize Superplan for your workspace.',
    '',
    'Usage:',
    '  superplan init',
    '  superplan init --global',
    '  superplan init --local',
    '  superplan init --yes',
    '  superplan init --json',
    '',
    'Options:',
    '  --global          install globally (all projects)',
    '  --local           install locally (this project only)',
    '  --yes             skip prompts with default choices',
    '  --quiet           non-interactive mode (alias for --yes --json)',
    '  --json            return structured output',
  ].join('\n');
}

export async function init(options: InitOptions = {}): Promise<InitResult> {
  try {
    const isQuiet = Boolean(options.quiet || options.json);
    const useDefaults = Boolean(options.yes || options.quiet || options.json);

    if (!isQuiet) {
      printSetupBanner();
    }

    const homeDir = os.homedir();
    const globalConfigPath = path.join(homeDir, '.config', 'superplan', 'config.toml');
    const globalSkillsDir = path.join(homeDir, '.config', 'superplan', 'skills');
    const globalPaths = getGlobalSuperplanPaths();

    // Determine installation scope: global or local
    let installScope: 'global' | 'local';
    
    if (options.global) {
      installScope = 'global';
    } else if (options.local) {
      installScope = 'local';
    } else if (!isQuiet) {
      const scopeChoice = await select({
        message: 'How would you like to install Superplan?',
        choices: [
          { name: 'Global - Available in all projects (~/.config/superplan/)', value: 'global' },
          { name: 'Local - Only this repository (visible in git)', value: 'local' },
        ],
      });
      installScope = scopeChoice as 'global' | 'local';
    } else {
      // Default to local in quiet mode
      installScope = 'local';
    }

    // Handle global installation
    if (installScope === 'global') {
      // Check if global superplan exists, if not install it
      if (!await pathExists(globalConfigPath)) {
        if (!isQuiet) {
          const proceedWithInstall = await confirm({
            message: 'Superplan global installation not found. Would you like to install it now?',
            default: true,
          });

          if (!proceedWithInstall) {
            return {
              ok: false,
              error: {
                code: 'INSTALL_REQUIRED',
                message: 'Superplan global installation is required.',
                retryable: false,
              },
            };
          }
        }

        const installResult = await runInstall({ quiet: true, json: true });
        if (!installResult.ok) {
          return {
            ok: false,
            error: {
              code: 'AUTO_INSTALL_FAILED',
              message: `Failed to install Superplan globally: ${installResult.error.message}`,
              retryable: false,
            },
          };
        }
      }

      // Ensure global workspace structure exists
      await ensureGlobalWorkspaceArtifacts();

      // Create a change for the current directory
      const currentDirName = getCurrentDirName();
      const changeSlug = `workspace-${currentDirName}`;
      await ensureGlobalChangeArtifacts(changeSlug, `Workspace: ${currentDirName}`);

      // Detect agents at global level
      const detectedGlobalAgents = await detectAgents(homeDir, 'global');
      const globalAgentsToInstall = detectedGlobalAgents.filter(a => a.detected);

      // Filter out agents already in registry
      const installedAgents = await getInstalledAgentsFromRegistry();
      const newAgents = globalAgentsToInstall.filter(a => !installedAgents.includes(a.name));

      // Agents that must always be local
      const localOnlyAgents = new Set(['amazonq', 'antigravity']);

      if (!isQuiet && globalAgentsToInstall.length > 0) {
        // Show which agents already have superplan globally
        const alreadyInstalled = globalAgentsToInstall.filter(a => installedAgents.includes(a.name));
        if (alreadyInstalled.length > 0) {
          const names = alreadyInstalled.map(a => getAgentDisplayName(a)).join(', ');
          console.log(`\nSuperplan already installed globally for: ${names}`);
        }

        // Show new agents to install
        if (newAgents.length > 0) {
          const names = newAgents.map(a => getAgentDisplayName(a)).join(', ');
          console.log(`\nIntegrating with new AI agents: ${names}`);
        }

        // Show local-only agents
        const localOnlyToInstall = globalAgentsToInstall.filter(a => localOnlyAgents.has(a.name));
        if (localOnlyToInstall.length > 0) {
          const names = localOnlyToInstall.map(a => getAgentDisplayName(a)).join(', ');
          console.log(`\nNote: ${names} will be installed locally (global not supported)`);
        }
      }

      // Install skills in new agents (excluding local-only for global scope)
      const globalInstallableAgents = newAgents.filter(a => !localOnlyAgents.has(a.name));
      if (globalInstallableAgents.length > 0) {
        await installAgentSkills(globalSkillsDir, globalInstallableAgents);
        await addAgentsToRegistry(globalInstallableAgents.map(a => a.name));
      }

      // Install local-only agents locally
      const localOnlyDetected = globalAgentsToInstall.filter(a => localOnlyAgents.has(a.name) && !installedAgents.includes(a.name));
      if (localOnlyDetected.length > 0) {
        await installAgentSkills(globalSkillsDir, localOnlyDetected);
        await addAgentsToRegistry(localOnlyDetected.map(a => a.name));
      }

      return {
        ok: true,
        data: {
          superplan_root: globalPaths.superplanRoot,
          agents: [...globalInstallableAgents, ...localOnlyDetected],
          verified: true,
          message: `Global Superplan initialized. Workspace tracked as "${changeSlug}".`,
        },
      };
    }

    // Handle local installation (skills only, no .superplan folder)
    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    const cwd = workspaceRoot;

    // Show disclaimer about local installation
    if (!isQuiet) {
      console.log('\n⚠️  Local installation will create files in this repository that are visible to other users via git.');
      console.log('   Consider using --global for project-agnostic installation.\n');
    }

    // Auto-install global config if missing (needed for skills)
    if (!await pathExists(globalConfigPath)) {
      if (!isQuiet) {
        const proceedWithInstall = await confirm({
          message: 'Superplan global installation not found. Would you like to install it now?',
          default: true,
        });

        if (!proceedWithInstall) {
          return {
            ok: false,
            error: {
              code: 'INSTALL_REQUIRED',
              message: 'Superplan global installation is required.',
              retryable: false,
            },
          };
        }
      }

      const installResult = await runInstall({ quiet: true, json: true });
      if (!installResult.ok) {
        return {
          ok: false,
          error: {
            code: 'AUTO_INSTALL_FAILED',
            message: `Failed to install Superplan globally: ${installResult.error.message}`,
            retryable: false,
          },
        };
      }
    }

    // Detect agents at project level
    const detectedProjectAgents = await detectAgents(workspaceRoot, 'project');
    
    // Check which agents already have superplan globally
    const installedAgents = await getInstalledAgentsFromRegistry();
    
    // Filter agents: skip if already installed globally (unless local-only)
    const localOnlyAgents = new Set(['amazonq', 'antigravity']);
    const agentsNeedingInstall = detectedProjectAgents.filter(a => {
      // Local-only agents always need local install
      if (localOnlyAgents.has(a.name)) return a.detected;
      // Others skip if globally installed
      return a.detected && !installedAgents.includes(a.name);
    });

    let projectAgentsToInstall: ExtendedAgentEnvironment[] = [];

    if (useDefaults) {
      projectAgentsToInstall = agentsNeedingInstall;
    } else {
      // For local init, show all available agents (not just detected)
      // so users can choose agents they want to set up
      const allProjectAgents = detectedProjectAgents;
      const sortedAgents = sortAgentsForSelection(allProjectAgents);
      
      // Mark already globally installed agents
      const choices = sortedAgents.map(agent => {
        const globallyInstalled = installedAgents.includes(agent.name);
        const isLocalOnly = localOnlyAgents.has(agent.name);
        const name = getAgentDisplayName(agent);
        const suffix = globallyInstalled && !isLocalOnly ? ' (already global - skipping)' : '';
        return {
          name: `${name}${suffix}`,
          value: agent,
          checked: !globallyInstalled || isLocalOnly,
          disabled: globallyInstalled && !isLocalOnly,
        };
      });

      projectAgentsToInstall = await checkbox({
        message: 'Select AI agents to integrate with this project:',
        choices,
        instructions: formatDetectedAgentInstructions(sortedAgents),
      });
    }

    if (projectAgentsToInstall.length > 0) {
      if (!isQuiet) {
        const names = projectAgentsToInstall.map(a => getAgentDisplayName(a)).join(', ');
        console.log(`\nIntegrating with AI agents: ${names}`);
      }
      await installAgentSkills(globalSkillsDir, projectAgentsToInstall);
      await addAgentsToRegistry(projectAgentsToInstall.map(a => a.name));
      
      // Ask user if they want to update .gitignore
      if (!isQuiet) {
        const shouldUpdateGitignore = await confirm({
          message: 'Update .gitignore to ignore agent configuration files?',
          default: true,
        });
        if (shouldUpdateGitignore) {
          await updateGitignoreForLocalInstall(cwd, projectAgentsToInstall);
        }
      }
    }

    // Common repo-level managed instruction files
    await installManagedInstructionsFile(path.join(cwd, 'AGENTS.md'), globalSkillsDir);
    if (hasAgent(projectAgentsToInstall, 'claude')) {
      await installManagedInstructionsFile(path.join(cwd, 'CLAUDE.md'), globalSkillsDir);
      await installManagedInstructionsFile(path.join(cwd, '.claude', 'CLAUDE.md'), globalSkillsDir);
    }

    const successMessage = projectAgentsToInstall.length > 0
      ? `Local installation complete with ${projectAgentsToInstall.length} agent integrations. Files are tracked in git.`
      : 'Local installation complete. Files are tracked in git.';

    return {
      ok: true,
      data: {
        superplan_root: globalPaths.superplanRoot,
        agents: projectAgentsToInstall,
        verified: true,
        message: successMessage,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'INIT_FAILED',
        message: error.message || 'An unknown error occurred',
        retryable: false,
      },
    };
  }
}
