import * as fs from 'fs/promises';
import * as path from 'path';
import * as https from 'node:https';
import { spawn } from 'node:child_process';
import { readInstallMetadata, type InstallMetadata } from '../install-metadata';
import { refreshInstalledSkills, type RefreshInstalledSkillsResult } from './install-helpers';
import { commandNextAction, type NextAction } from '../next-action';

const DEFAULT_REPO_URL = 'https://github.com/superplan-md/superplan-plugin.git';
const DEFAULT_REF = 'main';
const MOVING_REFS = new Set(['main', 'dev']);
const ALPHA_REF_PATTERN = /^alpha\.(\d+)$/i;

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
  runInstaller?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv; streamOutput?: boolean }) => Promise<CommandResult>;
  refreshSkills?: () => Promise<RefreshInstalledSkillsResult>;
  resolveLatestRelease?: (repoUrl: string, ref: string) => Promise<LatestReleaseInfo>;
  stopManagedProcesses?: (input: ManagedProcessTargets) => Promise<StopManagedProcessesResult>;
  reportProgress?: (message: string) => void;
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

interface ProgressOutput {
  isTTY?: boolean;
  write(chunk: string): boolean;
}

interface ProgressOutput {
  isTTY?: boolean;
  write(chunk: string): boolean;
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

async function resolveReusableOverlaySourcePath(
  overlayMetadata: InstallMetadata['overlay'] | null | undefined,
): Promise<string> {
  if (!overlayMetadata || overlayMetadata.install_method !== 'copied_prebuilt') {
    return '';
  }

  const candidates = [
    overlayMetadata.source_path?.trim() || '',
    overlayMetadata.install_path?.trim() || '',
  ];

  for (const candidate of candidates) {
    if (candidate && await pathExists(candidate)) {
      return candidate;
    }
  }

  return '';
}

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

function isMovingRef(ref: string): boolean {
  return MOVING_REFS.has(ref);
}

function isAlphaRef(ref: string): boolean {
  return ALPHA_REF_PATTERN.test(ref);
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

function requireGitHubRepo(repoUrl: string, lookupKind: string): { owner: string; repo: string } {
  const parsedRepo = parseGitHubRepo(repoUrl);
  if (!parsedRepo) {
    throw new Error(`${lookupKind} only supports GitHub repo URLs: ${repoUrl}`);
  }

  return parsedRepo;
}

async function requestGitHubJson<T>(requestPath: string, lookupKind: string): Promise<T> {
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
          reject(new Error(`${lookupKind} failed with status ${response.statusCode}`));
          return;
        }
        resolve(body);
      });
    });

    request.on('error', reject);
  });

  return JSON.parse(payload) as T;
}

async function resolveLatestCommitFromGitHub(repoUrl: string, branch: string): Promise<LatestReleaseInfo> {
  const parsedRepo = requireGitHubRepo(repoUrl, 'Latest commit lookup');
  const requestPath = `/repos/${parsedRepo.owner}/${parsedRepo.repo}/commits/${branch}`;
  const parsed = await requestGitHubJson<{
    sha?: string;
    html_url?: string;
  }>(requestPath, 'GitHub latest commit lookup');
  const commitish = parsed.sha?.trim();
  const url = parsed.html_url?.trim();

  if (!commitish || !url) {
    throw new Error('GitHub latest commit response was missing sha or html_url');
  }

  return {
    tag: branch,
    commitish,
    url,
  };
}

async function resolveLatestPublishedReleaseFromGitHub(repoUrl: string): Promise<LatestReleaseInfo> {
  const parsedRepo = requireGitHubRepo(repoUrl, 'Latest release lookup');
  const parsed = await requestGitHubJson<{
    tag_name?: string;
    html_url?: string;
  }>(`/repos/${parsedRepo.owner}/${parsedRepo.repo}/releases/latest`, 'GitHub latest release lookup');

  const tag = parsed.tag_name?.trim();
  const url = parsed.html_url?.trim();
  if (!tag || !url) {
    throw new Error('GitHub latest release response was missing tag_name or html_url');
  }

  return {
    tag,
    commitish: tag,
    url,
  };
}

async function resolveLatestAlphaReleaseFromGitHub(repoUrl: string): Promise<LatestReleaseInfo> {
  const parsedRepo = requireGitHubRepo(repoUrl, 'Latest release lookup');
  const parsed = await requestGitHubJson<Array<{
    tag_name?: string;
    html_url?: string;
    target_commitish?: string;
    draft?: boolean;
  }>>(`/repos/${parsedRepo.owner}/${parsedRepo.repo}/releases?per_page=100`, 'GitHub latest release lookup');

  const latestAlpha = parsed
    .map(release => {
      const tag = String(release.tag_name || '').trim();
      const match = tag.match(ALPHA_REF_PATTERN);
      const url = String(release.html_url || '').trim();
      if (!match || !url || release.draft) {
        return null;
      }

      return {
        tag,
        url,
        alphaNumber: Number(match[1]),
        targetCommitish: String(release.target_commitish || '').trim(),
      };
    })
    .filter((release): release is {
      tag: string;
      url: string;
      alphaNumber: number;
      targetCommitish: string;
    } => Boolean(release))
    .sort((left, right) => right.alphaNumber - left.alphaNumber)[0];

  if (!latestAlpha) {
    throw new Error('GitHub latest release lookup found no alpha releases');
  }

  return {
    tag: latestAlpha.tag,
    commitish: latestAlpha.targetCommitish || latestAlpha.tag,
    url: latestAlpha.url,
  };
}

export async function resolveLatestReleaseForRef(repoUrl: string, ref: string): Promise<LatestReleaseInfo> {
  const normalizedRef = ref.trim() || DEFAULT_REF;

  if (isMovingRef(normalizedRef)) {
    return await resolveLatestCommitFromGitHub(repoUrl, normalizedRef);
  }

  if (isAlphaRef(normalizedRef)) {
    return await resolveLatestAlphaReleaseFromGitHub(repoUrl);
  }

  return await resolveLatestPublishedReleaseFromGitHub(repoUrl);
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

async function runCommand(
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; streamOutput?: boolean },
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const text = String(chunk);
      stdout += text;
      if (options.streamOutput) {
        process.stderr.write(text);
      }
    });

    child.stderr.on('data', chunk => {
      const text = String(chunk);
      stderr += text;
      if (options.streamOutput) {
        process.stderr.write(text);
      }
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

function formatProgressMessage(progressPercent: number, message: string): string {
  const width = 20;
  const bounded = Math.max(0, Math.min(100, Math.round(progressPercent)));
  const filled = Math.round((bounded / 100) * width);
  const bar = `${'#'.repeat(filled)}${'-'.repeat(width - filled)}`;
  const percent = String(bounded).padStart(3, ' ');
  return `[${bar}] ${percent}% ${message}`;
}

function createProgressWriter(output: ProgressOutput): {
  update(progressPercent: number, message: string): void;
  finish(progressPercent: number, message: string): void;
} {
  let lastRenderedLength = 0;

  const render = (progressPercent: number, message: string, done: boolean): void => {
    const formatted = formatProgressMessage(progressPercent, message);
    if (output.isTTY) {
      const padded = formatted.padEnd(lastRenderedLength, ' ');
      output.write(`\r${padded}`);
      lastRenderedLength = padded.length;
      if (done) {
        output.write('\n');
        lastRenderedLength = 0;
      }
      return;
    }

    output.write(`${formatted}\n`);
  };

  return {
    update(progressPercent: number, message: string) {
      render(progressPercent, message, false);
    },
    finish(progressPercent: number, message: string) {
      render(progressPercent, message, true);
    },
  };
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
  const currentRef = installerRefOverride || installMetadata?.ref || DEFAULT_REF;
  const resolveLatestRelease = deps.resolveLatestRelease ?? ((url: string, ref: string) => resolveLatestReleaseForRef(url, ref));
  const stopProcesses = deps.stopManagedProcesses ?? stopManagedProcesses;
  const overlayInstallDir = process.env.SUPERPLAN_OVERLAY_INSTALL_DIR || installMetadata?.overlay?.install_dir || '';
  const runner = deps.runInstaller ?? runCommand;
  const refreshSkills = deps.refreshSkills ?? refreshInstalledSkills;
  const installerLaunch = getBundledInstallerCommand();
  const progressOutput = options.json ? process.stderr : process.stdout;
  const progressWriter = createProgressWriter(progressOutput);
  const useInteractiveProgressBar = !options.quiet && !deps.reportProgress && Boolean(progressOutput.isTTY);
  const emitProgress = (progressPercent: number, message: string, done = false): void => {
    if (options.quiet) {
      return;
    }

    if (deps.reportProgress) {
      deps.reportProgress(message);
      return;
    }

    if (useInteractiveProgressBar) {
      if (done) {
        progressWriter.finish(progressPercent, message);
      } else {
        progressWriter.update(progressPercent, message);
      }
      return;
    }

    progressOutput.write(`${formatProgressMessage(progressPercent, message)}\n`);
  };

  try {
    emitProgress(10, 'Checking latest available Superplan source...');
    const latestRelease = installerRefOverride
      ? {
          tag: installerRefOverride,
          commitish: installerRefOverride,
          url: `${repoUrl.replace(/\.git$/, '')}/releases/tag/${installerRefOverride}`,
        }
      : await resolveLatestRelease(repoUrl, currentRef);
    const ref = latestRelease.tag || currentRef;
    const overlayReleaseBaseUrl = process.env.SUPERPLAN_OVERLAY_RELEASE_BASE_URL
      || (isMovingRef(ref) ? '' : buildReleaseBaseUrl(repoUrl, ref));
    const overlaySourcePath = process.env.SUPERPLAN_OVERLAY_SOURCE_PATH
      || await resolveReusableOverlaySourcePath(installMetadata?.overlay)
      || '';
    emitProgress(25, `Preparing update from ${ref}${latestRelease.commitish && latestRelease.commitish !== ref ? ` (${latestRelease.commitish.slice(0, 12)})` : ''}...`);
    emitProgress(40, 'Stopping running Superplan processes...');
    const stopResult = await stopProcesses({
      installBinDir: installMetadata?.install_bin || (installPrefix ? path.join(installPrefix, 'bin') : null),
      overlayExecutablePath: installMetadata?.overlay?.executable_path || null,
    });
    emitProgress(65, 'Running installer...');
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
      streamOutput: !options.quiet && !useInteractiveProgressBar,
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

    emitProgress(85, 'Refreshing installed skills...');
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

    emitProgress(100, 'Update complete.', true);

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
    const errorMessage = String(error?.message || '');
    if (errorMessage.includes('latest commit') || errorMessage.includes('latest release')) {
      return {
        ok: false,
        error: {
          code: 'LATEST_COMMIT_LOOKUP_FAILED',
          message: error?.message || 'Latest commit lookup failed',
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
