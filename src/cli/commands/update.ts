import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'node:child_process';
import { readInstallMetadata, type InstallMetadata } from '../install-metadata';
import { refreshInstalledSkills, type RefreshInstalledSkillsResult } from './setup';

const DEFAULT_REPO_URL = 'https://github.com/superplan-md/cli.git';
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
}

export type UpdateResult =
  | {
      ok: true;
      data: {
        updated: true;
        install_method: 'remote_repo';
        repo_url: string;
        ref: string;
        install_prefix: string | null;
        skills_refreshed: boolean;
        skills_scope: 'skip' | 'global' | 'local' | 'both';
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

function getBundledInstallerPath(): string {
  return path.resolve(__dirname, '../../../scripts/install.sh');
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
  const ref = process.env.SUPERPLAN_REF || installMetadata?.ref || DEFAULT_REF;
  const installPrefix = process.env.SUPERPLAN_INSTALL_PREFIX || installMetadata?.install_prefix || '';
  const overlaySourcePath = process.env.SUPERPLAN_OVERLAY_SOURCE_PATH
    || (
      installMetadata?.overlay?.install_method === 'copied_prebuilt'
        ? installMetadata?.overlay?.source_path
        : ''
    )
    || '';
  const overlayReleaseBaseUrl = process.env.SUPERPLAN_OVERLAY_RELEASE_BASE_URL
    || installMetadata?.overlay?.release_base_url
    || '';
  const overlayInstallDir = process.env.SUPERPLAN_OVERLAY_INSTALL_DIR || installMetadata?.overlay?.install_dir || '';
  const runner = deps.runInstaller ?? runCommand;
  const refreshSkills = deps.refreshSkills ?? refreshInstalledSkills;

  try {
    const installResult = await runner('sh', [installerPath], {
      env: {
        ...process.env,
        SUPERPLAN_REPO_URL: repoUrl,
        SUPERPLAN_REF: ref,
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
        install_prefix: installPrefix || null,
        skills_refreshed: refreshResult.data.refreshed,
        skills_scope: refreshResult.data.scope,
      },
    };
  } catch (error: any) {
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
