import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { 
  pathExists, 
  directoryHasAtLeastOneFile,
  installSkills,
  installAgentSkills,
  detectAgents,
  ExtendedAgentEnvironment,
  getAgentDisplayName,
  MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START,
  MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END,
  installManagedInstructionsFile
} from './install-helpers';
import { readInstallMetadata, getInstallMetadataPath, type InstallMetadata } from '../install-metadata';
import { writeOverlayPreference } from '../overlay-preferences';
import { getBootstrapStrengthSummary } from '../agent-integrations';

export interface InstallOptions {
  json?: boolean;
  quiet?: boolean;
}

export type InstallResult =
  | {
      ok: true;
      data: {
        config_path: string;
        skills_path: string;
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

function hasAgent(agents: ExtendedAgentEnvironment[], name: ExtendedAgentEnvironment['name']): boolean {
  return agents.some(agent => agent.name === name);
}

async function ensureGlobalConfig(configPath: string): Promise<void> {
  const initialConfig = `version = "0.1"\n\n[agents]\ninstalled = []\n\n[overlay]\nenabled = true\n`;
  await fs.writeFile(configPath, initialConfig, 'utf-8');
}

async function installOverlayCompanion(globalConfigDir: string): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const platform = process.platform;
  let sourceBundlePath: string | null = null;
  let targetBundleName: string | null = null;
  let executableRelativePath: string | null = null;

  if (platform === 'darwin') {
    sourceBundlePath = path.join(
      repoRoot,
      'apps',
      'overlay-desktop',
      'src-tauri',
      'target',
      'release',
      'bundle',
      'macos',
      'Superplan Overlay Desktop.app',
    );
    targetBundleName = 'Superplan Overlay Desktop.app';
    executableRelativePath = 'Contents/MacOS/superplan-overlay-desktop';
  } else if (platform === 'linux') {
    const appImageDir = path.join(
      repoRoot,
      'apps',
      'overlay-desktop',
      'src-tauri',
      'target',
      'release',
      'bundle',
      'appimage',
    );
    if (await pathExists(appImageDir)) {
      const entries = await fs.readdir(appImageDir);
      const appImage = entries.find(e => e.endsWith('.AppImage'));
      if (appImage) {
        sourceBundlePath = path.join(appImageDir, appImage);
        targetBundleName = 'superplan-overlay.AppImage';
      }
    }
  } else if (platform === 'win32') {
    sourceBundlePath = path.join(
      repoRoot,
      'apps',
      'overlay-desktop',
      'src-tauri',
      'target',
      'release',
      'superplan-overlay-desktop.exe',
    );
    targetBundleName = 'superplan-overlay-desktop.exe';
  }

  if (sourceBundlePath && await pathExists(sourceBundlePath)) {
    const binDir = path.join(globalConfigDir, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const targetPath = path.join(binDir, targetBundleName!);

    await fs.rm(targetPath, { recursive: true, force: true });

    if (platform === 'darwin') {
      await fs.cp(sourceBundlePath, targetPath, { recursive: true });
    } else {
      await fs.copyFile(sourceBundlePath, targetPath);
      await fs.chmod(targetPath, 0o755);
    }

    const installMetadataPath = getInstallMetadataPath();
    const existingMetadata = await readInstallMetadata();
    const nextMetadata: InstallMetadata = {
      ...existingMetadata,
      overlay: {
        install_method: 'copied_prebuilt',
        install_path: targetPath,
        executable_path: executableRelativePath ? path.join(targetPath, executableRelativePath) : targetPath,
        installed_at: new Date().toISOString(),
      },
    };

    await fs.writeFile(installMetadataPath, JSON.stringify(nextMetadata, null, 2), 'utf-8');
  }
}

export async function ensureGlobalSetup(
  configDir: string,
  configPath: string,
  skillsDir: string,
  sourceSkillsDir: string,
  homeDir: string,
): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });

  if (!await pathExists(configPath)) {
    await ensureGlobalConfig(configPath);
  }

  await installSkills(sourceSkillsDir, skillsDir);
  
  if (await pathExists(path.join(homeDir, '.codex'))) {
    await installManagedInstructionsFile(path.join(homeDir, '.codex', 'AGENTS.md'), skillsDir);
  }
}

async function verifyGlobalSetup(paths: {
  globalConfigPath: string;
  globalSkillsDir: string;
  homeAgents: ExtendedAgentEnvironment[];
}): Promise<string[]> {
  const issues: string[] = [];

  if (!await pathExists(paths.globalConfigPath)) {
    issues.push('Global config was not installed correctly.');
  }

  const globalSkillsInstalled = await pathExists(paths.globalSkillsDir)
    && await directoryHasAtLeastOneFile(paths.globalSkillsDir);
  if (!globalSkillsInstalled) {
    issues.push('Global skills were not installed correctly.');
  }

  for (const agent of paths.homeAgents) {
    // Only verify agents that were actually detected and selected for installation
    if (agent.detected && agent.install_path && !await pathExists(agent.install_path)) {
      issues.push(`Global ${agent.name} integration was not installed correctly.`);
    }
  }

  return issues;
}

export function getInstallCommandHelpMessage(): string {
  return [
    'Install Superplan globally on this machine.',
    '',
    'Usage:',
    '  superplan install --json',
    '  superplan install --quiet',
    '',
    'Options:',
    '  --quiet           non-interactive mode with default choices',
    '  --json            return structured output',
  ].join('\n');
}

export async function install(options: InstallOptions = {}): Promise<InstallResult> {
  try {
    const nonInteractive = Boolean(options.quiet || options.json);

    if (!options.quiet && !options.json) {
      printSetupBanner();
    }

    const homeDir = os.homedir();
    const sourceSkillsDir = path.resolve(__dirname, '../../../output/skills');
    const globalConfigDir = path.join(homeDir, '.config', 'superplan');
    const globalConfigPath = path.join(globalConfigDir, 'config.toml');
    const globalSkillsDir = path.join(globalConfigDir, 'skills');

    await ensureGlobalSetup(globalConfigDir, globalConfigPath, globalSkillsDir, sourceSkillsDir, homeDir);
    await installOverlayCompanion(globalConfigDir);
    
    // Default global overlay to true for now since we're making this explicit
    await writeOverlayPreference(true, { scope: 'global' });

    const detectedHomeAgents = await detectAgents(homeDir, 'global');
    const homeAgents = detectedHomeAgents.filter(a => a.detected);

    if (homeAgents.length > 0) {
      if (!options.quiet && !options.json) {
        const names = homeAgents.map(a => getAgentDisplayName(a)).join(', ');
        console.log(`\nFound and auto-installed global AI agents: ${names}`);
      }
      await installAgentSkills(globalSkillsDir, homeAgents);
      if (hasAgent(homeAgents, 'claude')) {
        await installManagedInstructionsFile(path.join(homeDir, 'CLAUDE.md'), globalSkillsDir);
        await installManagedInstructionsFile(path.join(homeDir, '.claude', 'CLAUDE.md'), globalSkillsDir);
      }
    } else if (!options.quiet && !options.json) {
      console.log('\nNo machine-level AI agents detected.');
    }

    const verificationIssues = await verifyGlobalSetup({
      globalConfigPath,
      globalSkillsDir,
      homeAgents,
    });

    if (verificationIssues.length > 0) {
      return {
        ok: false,
        error: {
          code: 'INSTALL_VERIFICATION_FAILED',
          message: verificationIssues.join(' '),
          retryable: false,
        },
      };
    }

    const bootstrapLimitedAgents = homeAgents
      .filter(agent => (agent.bootstrap_strength ?? 'skills_only') === 'skills_only')
      .map(agent => `${getAgentDisplayName(agent)} (${getBootstrapStrengthSummary(agent.bootstrap_strength ?? 'skills_only')})`);

    const capabilityMessage = bootstrapLimitedAgents.length > 0
      ? ` Entry routing remains best-effort for ${bootstrapLimitedAgents.join(', ')} until a host bootstrap surface exists.`
      : '';

    return {
      ok: true,
      data: {
        config_path: globalConfigPath,
        skills_path: globalSkillsDir,
        agents: homeAgents,
        verified: true,
        message: `Global installation successful.${capabilityMessage}`,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'INSTALL_FAILED',
        message: error.message || 'An unknown error occurred',
        retryable: false,
      },
    };
  }
}
