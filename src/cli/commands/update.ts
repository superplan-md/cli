import * as fs from 'fs/promises';
import * as path from 'path';
import * as https from 'node:https';
import { spawn } from 'node:child_process';
import { readInstallMetadata, type InstallMetadata } from '../install-metadata';
import { refreshInstalledSkills, type RefreshInstalledSkillsResult } from './install-helpers';
import { commandNextAction, type NextAction } from '../next-action';

const DEFAULT_REPO_URL = 'https://github.com/superplan-md/superplan-plugin.git';
const DEFAULT_REF = 'dev';

interface UpdateOptions {
  json?: boolean;
  quiet?: boolean;
}

interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface UpdateDeps {
  installerPath?: string;
  readInstallMetadata?: () => Promise<InstallMetadata | null>;
  runInstaller?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => Promise<CommandResult>;
  refreshSkills?: () => Promise<RefreshInstalledSkillsResult>;
  resolveLatestRelease?: (repoUrl: string) => Promise<LatestReleaseInfo>;
  stopManagedProcesses?: (input: ManagedProcessTargets) => Promise<StopManagedProcessesResult>;
}

interface LatestReleaseInfo {
  tag: string;
  commitish: string;
  url: string;
}

interface ManagedProcessTargets {
  installBinDir: string | null;
  overlayExecutablePath: string | null;
}

interface ManagedProcessInfo {
  pid: number;
  kind: 'cli' | 'overlay';
  command: string;
}

interface StopManagedProcessesResult {
  stopped: ManagedProcessInfo[];
}

export type UpdateResult =
  | {
      ok: true;
      data: {
        updated: true;
        install_method: 'remote_repo';
        repo_url: string;
        ref: string;
        commitish: string;
        release_url: string;
        install_prefix: string | null;
        skills_refreshed: boolean;
        skills_scope: 'skip' | 'global' | 'local' | 'both';
        stopped_processes: number;
        next_action: NextAction;
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getBundledInstallerPath(platform = process.platform): string {
  return path.resolve(
    __dirname,
    platform === 'win32' ? '../../../scripts/install.ps1' : '../../../scripts/install.sh',
  );
}

function getBundledInstallerCommand(platform = process.platform): { command: string; args: string[] } {
  if (platform === 'win32') {
    return {
      command: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'],
    };
  }

  return {
    command: 'sh',
    args: [],
  };
}

function buildReleaseBaseUrl(repoUrl: string, tag: string): string {
  return `${repoUrl.replace(/\.git$/, '')}/releases/download/${tag}`;
}

function parseGitHubRepo(repoUrl: string): { owner: string; repo: string } | null {
  const sshMatch = repoUrl.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2],
    };
  }

  try {
    const parsedUrl = new URL(repoUrl);
    if (parsedUrl.hostname !== 'github.com') {
      return null;
    }

    const segments = parsedUrl.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (segments.length < 2) {
      return null;
    }

    return {
      owner: segments[0],
      repo: segments[1].replace(/\.git$/i, ''),
    };
  } catch {
    return null;
  }
}

async function resolveLatestReleaseFromGitHub(repoUrl: string): Promise<LatestReleaseInfo> {
  const parsedRepo = parseGitHubRepo(repoUrl);
  if (!parsedRepo) {
    throw new Error(`Latest release lookup only supports GitHub repo URLs: ${repoUrl}`);
  }

  const requestPath = `/repos/${parsedRepo.owner}/${parsedRepo.repo}/releases/latest`;

  const payload = await new Promise<string>((resolve, reject) => {
    const request = https.get({
      hostname: 'api.github.com',
      path: requestPath,
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'superplan-update',
      },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`GitHub latest release lookup failed with status ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });

    request.on('error', reject);
  });

  const parsed = JSON.parse(payload) as {
    tag_name?: string;
    target_commitish?: string;
    html_url?: string;
  };
  const tag = parsed.tag_name?.trim();
  const commitish = parsed.target_commitish?.trim();
  const url = parsed.html_url?.trim();

  if (!tag || !commitish || !url) {
    throw new Error('GitHub latest release response was missing tag_name, target_commitish, or html_url');
  }

  return {
    tag,
    commitish,
    url,
  };
}

function matchesManagedCommand(command: string, needle: string): boolean {
  const escapedNeedle = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)"?${escapedNeedle}"?(?=\\s|$)`).test(command);
}

async function listManagedProcesses(targets: ManagedProcessTargets): Promise<ManagedProcessInfo[]> {
  if (process.platform === 'win32') {
    return await new Promise((resolve, reject) => {
      const child = spawn('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress',
      ], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', chunk => {
        stdout += String(chunk);
      });

      child.stderr.on('data', chunk => {
        stderr += String(chunk);
      });

      child.on('error', reject);
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error((stderr || stdout || 'failed to inspect running processes').trim()));
          return;
        }

        try {
          const parsed = JSON.parse(stdout.trim() || '[]');
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          const installBinPath = targets.installBinDir ? path.join(targets.installBinDir, 'superplan.cmd') : null;
          const managedProcesses: ManagedProcessInfo[] = [];

          for (const row of rows) {
            const pid = Number(row?.ProcessId);
            const command = typeof row?.CommandLine === 'string' ? row.CommandLine.trim() : '';
            if (!pid || !command || pid === process.pid) {
              continue;
            }

            if (installBinPath && matchesManagedCommand(command, installBinPath)) {
              managedProcesses.push({ pid, kind: 'cli', command });
              continue;
            }

            if (targets.overlayExecutablePath && matchesManagedCommand(command, targets.overlayExecutablePath)) {
              managedProcesses.push({ pid, kind: 'overlay', command });
            }
          }

          resolve(managedProcesses);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  return await new Promise((resolve, reject) => {
    const child = spawn('ps', ['-axo', 'pid=,command='], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error((stderr || stdout || 'failed to inspect running processes').trim()));
        return;
      }

      const installBinPath = targets.installBinDir ? path.join(targets.installBinDir, 'superplan') : null;
      const managedProcesses: ManagedProcessInfo[] = [];
      for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        const match = line.match(/^(\d+)\s+(.*)$/);
        if (!match) {
          continue;
        }

        const pid = Number(match[1]);
        const command = match[2];
        if (pid === process.pid) {
          continue;
        }

        if (installBinPath && matchesManagedCommand(command, installBinPath)) {
          managedProcesses.push({
            pid,
            kind: 'cli',
            command,
          });
          continue;
        }

        if (targets.overlayExecutablePath && matchesManagedCommand(command, targets.overlayExecutablePath)) {
          managedProcesses.push({
            pid,
            kind: 'overlay',
            command,
          });
        }
      }

      resolve(managedProcesses);
    });
  });
}

async function stopManagedProcesses(targets: ManagedProcessTargets): Promise<StopManagedProcessesResult> {
  const managedProcesses = await listManagedProcesses(targets);

  for (const processInfo of managedProcesses) {
    try {
      process.kill(processInfo.pid, 'SIGTERM');
    } catch {
      // Best effort: continue even if the process already exited.
    }
  }

  return {
    stopped: managedProcesses,
  };
}

async function runCommand(command: string, args: string[], options: { env: NodeJS.ProcessEnv }): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', code => {
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

export async function update(options: UpdateOptions = {}, deps: Partial<UpdateDeps> = {}): Promise<UpdateResult> {
  const installerPath = deps.installerPath ?? getBundledInstallerPath();
  if (!await pathExists(installerPath)) {
    return {
      ok: false,
      error: {
        code: 'INSTALLER_NOT_FOUND',
        message: 'Bundled installer not found',
        retryable: false,
      },
    };
  }

  const metadataReader = deps.readInstallMetadata ?? readInstallMetadata;
  const installMetadata = await metadataReader();

  if (installMetadata?.install_method === 'local_source') {
    return {
      ok: false,
      error: {
        code: 'LOCAL_SOURCE_UPDATE_UNSUPPORTED',
        message: 'Local source installs should be updated from the source checkout and reinstalled explicitly',
        retryable: false,
      },
    };
  }

  const repoUrl = process.env.SUPERPLAN_REPO_URL || installMetadata?.repo_url || DEFAULT_REPO_URL;
  const installPrefix = process.env.SUPERPLAN_INSTALL_PREFIX || installMetadata?.install_prefix || '';
  const installerRefOverride = process.env.SUPERPLAN_REF;
  const resolveLatestRelease = deps.resolveLatestRelease ?? resolveLatestReleaseFromGitHub;
  const stopProcesses = deps.stopManagedProcesses ?? stopManagedProcesses;
  const overlayInstallDir = process.env.SUPERPLAN_OVERLAY_INSTALL_DIR || installMetadata?.overlay?.install_dir || '';
  const runner = deps.runInstaller ?? runCommand;
  const refreshSkills = deps.refreshSkills ?? refreshInstalledSkills;
  const installerLaunch = getBundledInstallerCommand();

  try {
    const latestRelease = installerRefOverride
      ? {
          tag: installerRefOverride,
          commitish: installerRefOverride,
          url: `${repoUrl.replace(/\.git$/, '')}/releases/tag/${installerRefOverride}`,
        }
      : await resolveLatestRelease(repoUrl);
    const ref = latestRelease.tag || installMetadata?.ref || DEFAULT_REF;
    const overlayReleaseBaseUrl = process.env.SUPERPLAN_OVERLAY_RELEASE_BASE_URL
      || buildReleaseBaseUrl(repoUrl, ref);
    const overlaySourcePath = process.env.SUPERPLAN_OVERLAY_SOURCE_PATH
      || (
        installMetadata?.overlay?.install_method === 'copied_prebuilt'
          ? installMetadata?.overlay?.source_path
          : ''
      )
      || '';
    const stopResult = await stopProcesses({
      installBinDir: installMetadata?.install_bin || (installPrefix ? path.join(installPrefix, 'bin') : null),
      overlayExecutablePath: installMetadata?.overlay?.executable_path || null,
    });
    const installResult = await runner(installerLaunch.command, [...installerLaunch.args, installerPath], {
      env: {
        ...process.env,
        SUPERPLAN_REPO_URL: repoUrl,
        SUPERPLAN_REF: ref,
        SUPERPLAN_LATEST_COMMITISH: latestRelease.commitish,
        ...(installPrefix ? { SUPERPLAN_INSTALL_PREFIX: installPrefix } : {}),
        ...(overlaySourcePath ? { SUPERPLAN_OVERLAY_SOURCE_PATH: overlaySourcePath } : {}),
        ...(overlayReleaseBaseUrl ? { SUPERPLAN_OVERLAY_RELEASE_BASE_URL: overlayReleaseBaseUrl } : {}),
        ...(overlayInstallDir ? { SUPERPLAN_OVERLAY_INSTALL_DIR: overlayInstallDir } : {}),
        SUPERPLAN_RUN_SETUP_AFTER_INSTALL: '0',
      },
    });

    if (installResult.code !== 0) {
      return {
        ok: false,
        error: {
          code: 'UPDATE_FAILED',
          message: (installResult.stderr || installResult.stdout || 'Superplan update failed').trim(),
          retryable: true,
        },
      };
    }

    const refreshResult = await refreshSkills();
    if (!refreshResult.ok) {
      return {
        ok: false,
        error: {
          code: 'SKILLS_REFRESH_FAILED',
          message: refreshResult.error.message,
          retryable: refreshResult.error.retryable,
        },
      };
    }

    return {
      ok: true,
      data: {
        updated: true,
        install_method: 'remote_repo',
        repo_url: repoUrl,
        ref,
        commitish: latestRelease.commitish,
        release_url: latestRelease.url,
        install_prefix: installPrefix || null,
        skills_refreshed: refreshResult.data.refreshed,
        skills_scope: refreshResult.data.scope,
        stopped_processes: stopResult.stopped.length,
        next_action: commandNextAction(
          'superplan doctor --json',
          'The CLI and skills were updated, so the next control-plane step is checking that the install is healthy.',
        ),
      },
    };
  } catch (error: any) {
    if (String(error?.message || '').includes('latest release')) {
      return {
        ok: false,
        error: {
          code: 'LATEST_RELEASE_LOOKUP_FAILED',
          message: error?.message || 'Latest release lookup failed',
          retryable: true,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: 'UPDATE_FAILED',
        message: error?.message || 'Superplan update failed',
        retryable: true,
      },
    };
  }
}
