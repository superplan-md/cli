import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'node:child_process';
import { readInstallMetadata } from './install-metadata';
import { readVisibilityEvents } from './visibility-runtime';

type OverlayCompanionSource = 'env' | 'install_metadata' | null;

export type OverlayCompanionIssue =
  | 'not_installed'
  | 'install_path_missing'
  | 'executable_missing'
  | 'launch_failed'
  | 'launch_suppressed'
  | 'not_requested';

export interface OverlayCompanionStatus {
  configured: boolean;
  launchable: boolean;
  source: OverlayCompanionSource;
  install_path: string | null;
  executable_path: string | null;
  reason?: OverlayCompanionIssue;
  message?: string;
}

export interface OverlayCompanionLaunchResult extends OverlayCompanionStatus {
  attempted: boolean;
  launched: boolean;
  workspace_path: string;
}

export interface MacosOverlayBundleLaunchPlan {
  mode: 'reuse_running' | 'handoff_existing_instance' | 'open_bundle';
  command: string | null;
  args: string[];
}

interface RunningProcessEntry {
  pid: number;
  command: string;
}

const LAUNCH_FAILURE_SUPPRESSION_WINDOW_MS = 60_000;
const LAUNCH_RESULT_WAIT_MS = process.platform === 'linux' ? 300 : 50;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizeConfiguredPath(value: string | undefined | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function resolveExecutableFromInstallPath(
  installPath: string,
  executableRelativePath?: string,
): Promise<string | null> {
  if (!await pathExists(installPath)) {
    return null;
  }

  const stats = await fs.stat(installPath);
  if (stats.isFile()) {
    return installPath;
  }

  const relativeExecutable = normalizeConfiguredPath(executableRelativePath);
  if (relativeExecutable) {
    const configuredExecutablePath = path.join(installPath, relativeExecutable);
    if (await pathExists(configuredExecutablePath)) {
      return configuredExecutablePath;
    }
  }

  const macOsExecutableDir = path.join(installPath, 'Contents', 'MacOS');
  if (await pathExists(macOsExecutableDir)) {
    const entries = await fs.readdir(macOsExecutableDir, { withFileTypes: true });
    const executableEntry = entries.find(entry => entry.isFile());
    if (executableEntry) {
      return path.join(macOsExecutableDir, executableEntry.name);
    }
  }

  return null;
}

function resolveMacosAppBundlePath(
  installPath: string | null,
  executablePath: string | null,
): string | null {
  const normalizedInstallPath = normalizeConfiguredPath(installPath);
  if (normalizedInstallPath?.endsWith('.app')) {
    return normalizedInstallPath;
  }

  const normalizedExecutablePath = normalizeConfiguredPath(executablePath);
  if (!normalizedExecutablePath) {
    return null;
  }

  let currentPath = path.dirname(normalizedExecutablePath);
  while (currentPath !== path.dirname(currentPath)) {
    if (currentPath.endsWith('.app')) {
      return currentPath;
    }

    currentPath = path.dirname(currentPath);
  }

  return null;
}

export function commandMatchesExecutablePath(commandLine: string, executablePath: string): boolean {
  const escapedExecutablePath = escapeRegExp(executablePath);
  if (new RegExp(`(^|\\s)"?${escapedExecutablePath}"?(?=\\s|$)`).test(commandLine)) {
    return true;
  }

  // On macOS, processes launched via `open -a <bundle>` appear in ps as the
  // product name rather than the full executable path.  Accept both the
  // canonical Tauri binary names so we don't start a second instance.
  const macosBundleNames = [
    'Superplan Overlay Desktop',
    'superplan-overlay-desktop',
  ];
  return macosBundleNames.some(
    name => commandLine === name
      || commandLine.startsWith(`${name} `)
      || commandLine.includes(` ${name} `)
      || commandLine.endsWith(` ${name}`),
  );
}

export function commandMatchesWorkspacePath(commandLine: string, workspacePath: string): boolean {
  const escapedWorkspacePath = escapeRegExp(workspacePath);
  return new RegExp(`(^|\\s)--workspace(?:\\s+|=)"?${escapedWorkspacePath}"?(?=\\s|$)`).test(commandLine);
}

function parseRunningProcessEntry(line: string): RunningProcessEntry | null {
  const match = line.trim().match(/^(\d+)\s+(.*)$/);
  if (!match) {
    return null;
  }

  return {
    pid: Number.parseInt(match[1], 10),
    command: match[2].trim(),
  };
}

export function parseWindowsProcessEntriesPayload(stdout: string): RunningProcessEntry[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as (
    { ProcessId?: number; CommandLine?: string | null }
    | Array<{ ProcessId?: number; CommandLine?: string | null }>
  );
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows
    .map(row => {
      const pid = typeof row.ProcessId === 'number' ? row.ProcessId : null;
      const command = typeof row.CommandLine === 'string' ? row.CommandLine.trim() : '';
      if (!pid || !command) {
        return null;
      }

      return { pid, command };
    })
    .filter((entry): entry is RunningProcessEntry => entry !== null);
}



async function waitForLaunchResult(child: ReturnType<typeof spawn>): Promise<{ ok: true } | { ok: false; message: string }> {
  return await new Promise(resolve => {
    let settled = false;

    const finish = (result: { ok: true } | { ok: false; message: string }) => {
      if (settled) {
        return;
      }

      settled = true;
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      clearTimeout(timer);
      resolve(result);
    };

    const onError = (error: Error & { message?: string }) => {
      finish({
        ok: false,
        message: error?.message || 'Failed to launch overlay companion.',
      });
    };

    const onExit = (code: number | null) => {
      if (process.platform !== 'linux' || code === null) {
        return;
      }

      finish({
        ok: false,
        message: `Overlay companion exited immediately (exit code ${code}). On Linux, ensure FUSE is installed: sudo apt install fuse libfuse2`,
      });
    };

    const timer = setTimeout(() => {
      finish({ ok: true });
    }, LAUNCH_RESULT_WAIT_MS);

    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function readRunningProcessEntries(): Promise<RunningProcessEntry[] | null> {
  if (process.platform === 'win32') {
    return await new Promise(resolve => {
      const child = spawn('powershell', [
        '-NoProfile',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress',
      ], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      let stdout = '';

      child.stdout.on('data', chunk => {
        stdout += String(chunk);
      });

      child.on('error', () => {
        resolve(null);
      });

      child.on('close', code => {
        if (code !== 0) {
          resolve(null);
          return;
        }

        try {
          resolve(parseWindowsProcessEntriesPayload(stdout));
        } catch {
          resolve(null);
        }
      });
    });
  }

  return await new Promise(resolve => {
    const child = spawn('/bin/ps', ['-axo', 'pid=,command='], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    let stdout = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.on('error', () => {
      resolve(null);
    });

    child.on('close', code => {
      if (code !== 0) {
        resolve(null);
        return;
      }

      resolve(
        stdout
          .split(/\r?\n/)
          .map(parseRunningProcessEntry)
          .filter((entry): entry is RunningProcessEntry => entry !== null),
      );
    });
  });
}

function getMatchingOverlayProcesses(
  runningProcesses: RunningProcessEntry[],
  executablePath: string,
): RunningProcessEntry[] {
  return runningProcesses.filter(entry => commandMatchesExecutablePath(entry.command, executablePath));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    if (error?.code === 'ESRCH') {
      return false;
    }

    throw error;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function terminateProcess(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch (error: any) {
    if (error?.code === 'ESRCH') {
      return;
    }

    throw error;
  }

  try {
    await waitForProcessExit(pid, 750);
    return;
  } catch {}

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error: any) {
    if (error?.code === 'ESRCH') {
      return;
    }

    throw error;
  }

  await waitForProcessExit(pid, 750).catch(() => {});
}

export function getMacosOverlayBundleLaunchPlan(input: {
  appBundlePath: string;
  executablePath: string;
  workspacePath: string;
  // Bug #10: accepts full entries (pid + command) so the caller avoids a
  // second `ps` spawn; only the command strings are used here.
  runningProcessEntries: Array<{ pid: number; command: string }>;
}): MacosOverlayBundleLaunchPlan {
  const runningCommandLines = input.runningProcessEntries.map(e => e.command);
  const matchingCommands = runningCommandLines.filter(commandLine => (
    commandMatchesExecutablePath(commandLine, input.executablePath)
  ));

  if (matchingCommands.some(commandLine => commandMatchesWorkspacePath(commandLine, input.workspacePath))) {
    return {
      mode: 'reuse_running',
      command: null,
      args: [],
    };
  }

  if (matchingCommands.length > 0) {
    return {
      mode: 'handoff_existing_instance',
      command: input.executablePath,
      args: ['--workspace', input.workspacePath],
    };
  }

  return {
    mode: 'open_bundle',
    command: '/usr/bin/open',
    args: ['-a', input.appBundlePath, '--args', '--workspace', input.workspacePath],
  };
}

async function resolveOverlayCompanionStatusFromPaths(input: {
  source: Exclude<OverlayCompanionSource, null>;
  installPath: string | null;
  executablePath: string | null;
  executableRelativePath?: string;
}): Promise<OverlayCompanionStatus> {
  const installPath = input.installPath;
  const configuredExecutablePath = input.executablePath;

  if (!installPath && !configuredExecutablePath) {
    return {
      configured: false,
      launchable: false,
      source: input.source,
      install_path: null,
      executable_path: null,
      reason: 'not_installed',
      message: 'Overlay companion is not installed.',
    };
  }

  if (installPath && !await pathExists(installPath)) {
    return {
      configured: true,
      launchable: false,
      source: input.source,
      install_path: installPath,
      executable_path: configuredExecutablePath,
      reason: 'install_path_missing',
      message: `Overlay install path is missing: ${installPath}`,
    };
  }

  const resolvedExecutablePath = configuredExecutablePath
    ? (await pathExists(configuredExecutablePath) ? configuredExecutablePath : null)
    : (installPath ? await resolveExecutableFromInstallPath(installPath, input.executableRelativePath) : null);

  // Fix C/D: if the stored executable_path is stale (file moved/reinstalled)
  // but the install_path still exists, try to re-resolve from install_path
  // rather than returning an unhelpful 'executable_missing' error.
  const finalExecutablePath = resolvedExecutablePath
    ?? (configuredExecutablePath && !resolvedExecutablePath && installPath
      ? await resolveExecutableFromInstallPath(installPath, input.executableRelativePath)
      : null);

  if (!finalExecutablePath) {
    return {
      configured: true,
      launchable: false,
      source: input.source,
      install_path: installPath,
      executable_path: configuredExecutablePath,
      reason: 'executable_missing',
      message: 'Overlay executable could not be resolved from the installed companion.',
    };
  }

  return {
    configured: true,
    launchable: true,
    source: input.source,
    install_path: installPath,
    executable_path: finalExecutablePath,
  };
}

export async function inspectOverlayCompanionInstall(): Promise<OverlayCompanionStatus> {
  const envExecutablePath = normalizeConfiguredPath(process.env.SUPERPLAN_OVERLAY_BINARY_PATH);
  const envInstallPath = normalizeConfiguredPath(process.env.SUPERPLAN_OVERLAY_APP_PATH);

  if (envExecutablePath || envInstallPath) {
    return resolveOverlayCompanionStatusFromPaths({
      source: 'env',
      installPath: envInstallPath,
      executablePath: envExecutablePath,
    });
  }

  const installMetadata = await readInstallMetadata();
  const overlayMetadata = installMetadata?.overlay;
  if (!overlayMetadata) {
    return {
      configured: false,
      launchable: false,
      source: null,
      install_path: null,
      executable_path: null,
      reason: 'not_installed',
      message: 'Overlay companion is not installed.',
    };
  }

  return resolveOverlayCompanionStatusFromPaths({
    source: 'install_metadata',
    installPath: normalizeConfiguredPath(overlayMetadata.install_path),
    executablePath: normalizeConfiguredPath(overlayMetadata.executable_path),
    executableRelativePath: overlayMetadata.executable_relative_path,
  });
}

export async function launchInstalledOverlayCompanion(
  workspacePath = process.cwd(),
): Promise<OverlayCompanionLaunchResult> {
  const resolvedWorkspacePath = await fs.realpath(workspacePath).catch(() => path.resolve(workspacePath));
  const companionStatus = await inspectOverlayCompanionInstall();

  if (!companionStatus.launchable || !companionStatus.executable_path) {
    return {
      ...companionStatus,
      attempted: false,
      launched: false,
      workspace_path: resolvedWorkspacePath,
    };
  }

  try {
    const recentLaunchFailure = await findRecentLaunchFailure(resolvedWorkspacePath);
    if (recentLaunchFailure) {
      return {
        ...companionStatus,
        attempted: false,
        launched: false,
        workspace_path: resolvedWorkspacePath,
        reason: 'launch_suppressed',
        message: recentLaunchFailure,
      };
    }

    // Bug #10 fix: make ONE ps call and reuse the result for both the dedup
    // check and the macOS bundle launch plan.  The original code made two
    // separate ps spawns (readRunningProcessEntries + readProcessCommandLines)
    // which wasted 100–400ms per ensure invocation.
    const runningProcesses = await readRunningProcessEntries();
    const matchingProcesses = runningProcesses && companionStatus.executable_path
      ? getMatchingOverlayProcesses(runningProcesses, companionStatus.executable_path)
      : [];
    const matchingWorkspaceProcesses = matchingProcesses.filter(processEntry => (
      commandMatchesWorkspacePath(processEntry.command, resolvedWorkspacePath)
    ));

    if (matchingWorkspaceProcesses.length > 0) {
      return {
        ...companionStatus,
        attempted: false,
        launched: true,
        workspace_path: resolvedWorkspacePath,
      };
    }

    const commonSpawnOptions = {
      cwd: resolvedWorkspacePath,
      detached: true,
      stdio: 'ignore' as const,
      env: {
        ...process.env,
        SUPERPLAN_OVERLAY_WORKSPACE: resolvedWorkspacePath,
      },
    };
    const macosAppBundlePath = process.platform === 'darwin'
      ? resolveMacosAppBundlePath(companionStatus.install_path, companionStatus.executable_path)
      : null;

    // Bug #10: reuse runningProcesses already fetched above for the macOS
    // launch plan; no second ps spawn needed.
    const launchPlan = matchingProcesses.length > 0
      ? {
          mode: 'handoff_existing_instance' as const,
          command: companionStatus.executable_path,
          args: ['--workspace', resolvedWorkspacePath],
        }
      : macosAppBundlePath
        ? (runningProcesses
          ? getMacosOverlayBundleLaunchPlan({
              appBundlePath: macosAppBundlePath,
              executablePath: companionStatus.executable_path,
              workspacePath: resolvedWorkspacePath,
              runningProcessEntries: runningProcesses,
            })
          : {
              mode: 'handoff_existing_instance' as const,
              command: companionStatus.executable_path,
              args: ['--workspace', resolvedWorkspacePath],
            })
        : {
            command: companionStatus.executable_path,
            args: ['--workspace', resolvedWorkspacePath],
          };

    if (!launchPlan.command) {
      return {
        ...companionStatus,
        attempted: false,
        launched: true,
        workspace_path: resolvedWorkspacePath,
      };
    }

    const child = spawn(launchPlan.command, launchPlan.args, commonSpawnOptions);
    child.unref();
    const launchResult = await waitForLaunchResult(child);
    if (!launchResult.ok) {
      return {
        ...companionStatus,
        attempted: true,
        launched: false,
        workspace_path: resolvedWorkspacePath,
        reason: 'launch_failed',
        message: launchResult.message,
      };
    }

    return {
      ...companionStatus,
      attempted: true,
      launched: true,
      workspace_path: resolvedWorkspacePath,
    };
  } catch (error: any) {
    return {
      ...companionStatus,
      attempted: true,
      launched: false,
      workspace_path: resolvedWorkspacePath,
      reason: 'launch_failed',
      message: error?.message || 'Failed to launch overlay companion.',
    };
  }
}

// Bug #11 fix: accept an optional workspacePath so only the overlay process
// for the CURRENT workspace is terminated. Without this, on a machine with
// multiple superplan workspaces open, hiding one overlay killed ALL of them.
export async function terminateInstalledOverlayCompanion(workspacePath?: string): Promise<void> {
  const companionStatus = await inspectOverlayCompanionInstall();

  if (!companionStatus.launchable || !companionStatus.executable_path) {
    return;
  }

  const runningProcesses = await readRunningProcessEntries();
  if (!runningProcesses) {
    return;
  }

  const resolvedWorkspacePath = workspacePath
    ? await fs.realpath(workspacePath).catch(() => path.resolve(workspacePath))
    : null;

  const matchingProcesses = getMatchingOverlayProcesses(runningProcesses, companionStatus.executable_path)
    .filter(entry => !resolvedWorkspacePath || commandMatchesWorkspacePath(entry.command, resolvedWorkspacePath));

  for (const processEntry of matchingProcesses) {
    await terminateProcess(processEntry.pid);
  }
}

async function findRecentLaunchFailure(workspacePath: string): Promise<string | null> {
  const events = await readVisibilityEvents(workspacePath);
  const cutoff = Date.now() - LAUNCH_FAILURE_SUPPRESSION_WINDOW_MS;
  const recentFailure = [...events]
    .reverse()
    .find(event =>
      event.type === 'overlay.ensure'
      && event.outcome === 'error'
      && event.detail_code === 'launch_failed'
      && event.ts >= cutoff,
    );

  if (!recentFailure) {
    return null;
  }

  const elapsedMs = Math.max(Date.now() - recentFailure.ts, 0);
  return `Recent overlay launch failure detected ${elapsedMs}ms ago; suppressing immediate retry.`;
}
