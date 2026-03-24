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
import { readTelemetryConfig, writeTelemetryConfig } from '../telemetry-preferences';
import { captureEvent } from '../telemetry';

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

async function verifyLocalSetup(paths: {
  superplanRoot: string;
  projectAgents: ExtendedAgentEnvironment[];
}): Promise<string[]> {
  const issues: string[] = [];

  if (!await pathExists(paths.superplanRoot)) {
    issues.push('Local .superplan directory was not created.');
  }

  for (const agent of paths.projectAgents) {
    if (!await pathExists(agent.install_path)) {
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
      if (!isQuiet) {
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

    // Telemetry opt-in check
    const telemetryConfig = await readTelemetryConfig();
    if (telemetryConfig.enabled === null && !useDefaults && !isQuiet) {
      const allowTelemetry = await confirm({
        message: 'Allow Superplan to collect anonymous usage data to help improve the tool?',
        default: true,
      });
      await writeTelemetryConfig({ enabled: allowTelemetry });
    } else if (telemetryConfig.enabled === null && useDefaults) {
      // Default to false for non-interactive/quiet setups if not already set, 
      // or we could default to true if we want to be more aggressive.
      // Let's default to false to be safe.
      await writeTelemetryConfig({ enabled: false });
    }

    const workspaceRoot = resolveWorkspaceRoot(process.cwd());
    const cwd = workspaceRoot;
    const sourceSkillsDir = path.resolve(__dirname, '../../../output/skills');
    const superplanRoot = path.join(workspaceRoot, '.superplan');
    const localSkillsDir = path.join(superplanRoot, 'skills');

    await fs.mkdir(superplanRoot, { recursive: true });
    await installSkills(sourceSkillsDir, localSkillsDir);

    const workspaceArtifacts = await ensureWorkspaceArtifacts(superplanRoot);

    const detectedProjectAgents = await detectAgents(workspaceRoot, 'project');
    
    await captureEvent('project_initialized', {
      agents_detected: detectedProjectAgents.filter(a => a.detected).map(a => a.name)
    });
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
      await installAgentSkills(localSkillsDir, projectAgentsToInstall);
    }

    // Common repo-level managed instruction files
    await installManagedInstructionsFile(path.join(cwd, 'AGENTS.md'));
    if (await pathExists(path.join(cwd, '.claude'))) {
      await installManagedInstructionsFile(path.join(cwd, '.claude', 'CLAUDE.md'));
    }

    // Save local overlay preference
    let overlayEnabled = true;
    if (!useDefaults) {
      overlayEnabled = await confirm({
        message: 'Enable Superplan Overlay for this project?',
        default: true,
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
