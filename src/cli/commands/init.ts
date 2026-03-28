import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { checkbox, confirm } from '@inquirer/prompts';
import { 
  pathExists, 
  installSkills,
  installAgentSkills,
  detectAgents,
  ExtendedAgentEnvironment,
  getAgentDisplayName,
  sortAgentsForSelection,
  installManagedInstructionsFile,
  resolveWorkspaceRoot
} from './install-helpers';
import { install as runInstall } from './install';
import { writeOverlayPreference } from '../overlay-preferences';
import { ensureWorkspaceArtifacts } from '../workspace-artifacts';

export interface InitOptions {
  yes?: boolean;
  quiet?: boolean;
  json?: boolean;
}

export type InitResult =
  | {
      ok: true;
      data: {
        superplan_root: string;
        agents: ExtendedAgentEnvironment[];
        workspace_artifacts: string[];
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

async function verifyLocalSetup(paths: {
  superplanRoot: string;
  projectAgents: ExtendedAgentEnvironment[];
}): Promise<string[]> {
  const issues: string[] = [];

  if (!await pathExists(paths.superplanRoot)) {
    issues.push('Local .superplan directory was not created.');
  }

  for (const agent of paths.projectAgents) {
    if (agent.install_path && !await pathExists(agent.install_path)) {
      issues.push(`Local ${agent.name} integration was not installed correctly.`);
    }
  }

  return issues;
}

export function getInitCommandHelpMessage(): string {
  return [
    'Initialize the current repository for Superplan.',
    '',
    'Usage:',
    '  superplan init',
    '  superplan init --yes',
    '  superplan init --json',
    '',
    'Options:',
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

    // Auto-install check
    if (!await pathExists(globalConfigPath)) {
      if (!useDefaults && !isQuiet) {
        const proceedWithInstall = await confirm({
          message: 'Superplan global configuration not found. Would you like to install it now?',
          default: true,
        });

        if (!proceedWithInstall) {
          return {
            ok: false,
            error: {
              code: 'INSTALL_REQUIRED',
              message: 'Superplan global installation is required to initialize a project.',
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

    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    const cwd = workspaceRoot;
    const superplanRoot = path.join(workspaceRoot, '.superplan');
    const globalSkillsDir = path.join(homeDir, '.config', 'superplan', 'skills');

    await fs.mkdir(superplanRoot, { recursive: true });

    const workspaceArtifacts = await ensureWorkspaceArtifacts(superplanRoot);

    const detectedProjectAgents = await detectAgents(workspaceRoot, 'project');
    let projectAgentsToInstall: ExtendedAgentEnvironment[] = [];

    if (useDefaults) {
      projectAgentsToInstall = detectedProjectAgents.filter(a => a.detected);
    } else {
      const sortedAgents = sortAgentsForSelection(detectedProjectAgents);
      projectAgentsToInstall = await checkbox({
        message: 'Select AI agents to integrate with this project:',
        choices: sortedAgents.map(agent => ({
          name: getAgentDisplayName(agent),
          value: agent,
          checked: agent.detected,
        })),
        instructions: formatDetectedAgentInstructions(sortedAgents),
      });
    }

    if (projectAgentsToInstall.length > 0) {
      if (!isQuiet) {
        const names = projectAgentsToInstall.map(a => getAgentDisplayName(a)).join(', ');
        console.log(`\nIntegrating with AI agents: ${names}`);
      }
      // Pass empty skillsDir string since we're using globalSkillsDir internally in installAgentSkills
      await installAgentSkills('', projectAgentsToInstall);
    }

    // Common repo-level managed instruction files
    await installManagedInstructionsFile(path.join(cwd, 'AGENTS.md'), globalSkillsDir);
    if (hasAgent(projectAgentsToInstall, 'claude')) {
      await installManagedInstructionsFile(path.join(cwd, 'CLAUDE.md'), globalSkillsDir);
      await installManagedInstructionsFile(path.join(cwd, '.claude', 'CLAUDE.md'), globalSkillsDir);
    }

    // Save local overlay preference - DISABLED by default to prevent crashes
    let overlayEnabled = false;
    if (!useDefaults) {
      overlayEnabled = await confirm({
        message: 'Enable Superplan Overlay for this project? (Experimental - may cause system issues)',
        default: false,
      });
    }
    await writeOverlayPreference(overlayEnabled, { scope: 'local' });

    const verificationIssues = await verifyLocalSetup({
      superplanRoot,
      projectAgents: projectAgentsToInstall,
    });

    if (verificationIssues.length > 0) {
      return {
        ok: false,
        error: {
          code: 'INIT_VERIFICATION_FAILED',
          message: verificationIssues.join(' '),
          retryable: false,
        },
      };
    }

    const successMessage = projectAgentsToInstall.length > 0
      ? `Project initialized successfully with ${projectAgentsToInstall.length} agent integrations.`
      : 'Project initialized successfully.';

    return {
      ok: true,
      data: {
        superplan_root: superplanRoot,
        agents: projectAgentsToInstall,
        workspace_artifacts: workspaceArtifacts,
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
