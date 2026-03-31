import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { execFileSync } from 'node:child_process';
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

function normalizeOverlayArch(rawArch: string = process.arch): 'x64' | 'arm64' | null {
  if (rawArch === 'x64' || rawArch === 'arm64') {
    return rawArch;
  }

  if (rawArch === 'x86_64' || rawArch === 'amd64') {
    return 'x64';
  }

  if (rawArch === 'aarch64') {
    return 'arm64';
  }

  return null;
}

function getOverlayReleaseArtifactName(platform: NodeJS.Platform, arch: 'x64' | 'arm64' | null): string | null {
  if (!arch) {
    return null;
  }

  if (platform === 'darwin') {
    return `superplan-overlay-darwin-${arch}.tar.gz`;
  }

  if (platform === 'linux') {
    return `superplan-overlay-linux-${arch}.AppImage`;
  }

  if (platform === 'win32') {
    return `superplan-overlay-windows-${arch}.exe`;
  }

  return null;
}

async function findMacOverlayBundle(desktopDistDir: string): Promise<string | null> {
  if (!await pathExists(desktopDistDir)) {
    return null;
  }

  const entries = await fs.readdir(desktopDistDir, { withFileTypes: true });
  const matches: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('mac')) {
      continue;
    }

    const candidate = path.join(desktopDistDir, entry.name, 'Superplan.app');
    if (await pathExists(candidate)) {
      matches.push(candidate);
    }
  }

  matches.sort((left, right) => left.localeCompare(right));
  return matches[0] ?? null;
}

async function findLinuxOverlayAppImage(desktopDistDir: string): Promise<string | null> {
  if (!await pathExists(desktopDistDir)) {
    return null;
  }

  const entries = await fs.readdir(desktopDistDir, { withFileTypes: true });
  const matches = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.AppImage'))
    .map(entry => path.join(desktopDistDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  return matches[0] ?? null;
}

async function findWindowsOverlayPortable(desktopDistDir: string): Promise<string | null> {
  if (!await pathExists(desktopDistDir)) {
    return null;
  }

  const entries = await fs.readdir(desktopDistDir, { withFileTypes: true });
  const matches = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.exe') && /portable/i.test(entry.name))
    .map(entry => path.join(desktopDistDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  return matches[0] ?? null;
}

function extractTarArchive(archivePath: string, destinationDir: string): string {
  const archiveListing = execFileSync('tar', ['-tzf', archivePath], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const archiveRoot = archiveListing
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^\.?\//, '').split('/')[0])
    .find(Boolean);

  if (!archiveRoot) {
    throw new Error(`Failed to determine archive root for ${archivePath}`);
  }

  execFileSync('tar', ['-xzf', archivePath, '-C', destinationDir], {
    stdio: 'inherit',
  });

  return path.join(destinationDir, archiveRoot);
}

async function installOverlayCompanion(globalConfigDir: string): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const platform = process.platform;
  const arch = normalizeOverlayArch();
  const releaseArtifactName = getOverlayReleaseArtifactName(platform, arch);
  const releaseArtifactPath = releaseArtifactName
    ? path.join(repoRoot, 'dist', 'release', 'overlay', releaseArtifactName)
    : null;
  const desktopDistDir = path.join(repoRoot, 'apps', 'desktop', 'dist');
  let sourceBundlePath: string | null = null;
  let sourceArtifactPath: string | null = releaseArtifactPath && await pathExists(releaseArtifactPath)
    ? releaseArtifactPath
    : null;
  let targetBundleName: string | null = null;
  let executableRelativePath: string | null = null;

  if (platform === 'darwin') {
    sourceBundlePath = await findMacOverlayBundle(desktopDistDir);
    targetBundleName = 'Superplan.app';
    executableRelativePath = 'Contents/MacOS/Superplan';
  } else if (platform === 'linux') {
    sourceBundlePath = await findLinuxOverlayAppImage(desktopDistDir);
    targetBundleName = 'superplan-overlay.AppImage';
  } else if (platform === 'win32') {
    sourceBundlePath = await findWindowsOverlayPortable(desktopDistDir);
    targetBundleName = 'superplan-overlay.exe';
  }

  if (sourceArtifactPath || sourceBundlePath) {
    const binDir = path.join(globalConfigDir, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const targetPath = path.join(binDir, targetBundleName!);
    await fs.rm(targetPath, { recursive: true, force: true });

    let installPath = targetPath;
    const sourcePath = sourceArtifactPath ?? sourceBundlePath!;

    if (platform === 'darwin' && sourceArtifactPath?.endsWith('.tar.gz')) {
      installPath = extractTarArchive(sourceArtifactPath, binDir);
    } else if (platform === 'darwin') {
      await fs.cp(sourcePath, targetPath, { recursive: true });
    } else {
      await fs.copyFile(sourcePath, targetPath);
      await fs.chmod(targetPath, 0o755).catch(() => undefined);
    }

    const installMetadataPath = getInstallMetadataPath();
    const existingMetadata = await readInstallMetadata();
    const nextMetadata: InstallMetadata = {
      ...existingMetadata,
      overlay: {
        install_method: 'copied_prebuilt',
        source_path: sourcePath,
        asset_name: path.basename(sourcePath),
        install_dir: binDir,
        install_path: installPath,
        executable_path: executableRelativePath ? path.join(installPath, executableRelativePath) : installPath,
        executable_relative_path: executableRelativePath ?? undefined,
        platform: platform === 'win32' ? 'windows' : platform,
        arch: arch ?? process.arch,
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
