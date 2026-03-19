import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { confirm } from '@inquirer/prompts';
import { setup, type SetupResult } from './setup';

export type InitResult =
  | { ok: true; data: { root: string } }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export interface InitOptions {
  quiet?: boolean;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function init(options: InitOptions = {}): Promise<InitResult> {
  const cwd = process.cwd();
  const superplanRoot = path.join(cwd, '.superplan');
  const configPath = path.join(superplanRoot, 'config.toml');
  const contextDir = path.join(superplanRoot, 'context');
  const runtimeDir = path.join(superplanRoot, 'runtime');
  const changesDir = path.join(cwd, 'changes');
  const globalConfigPath = path.join(os.homedir(), '.config', 'superplan', 'config.toml');

  try {
    if (!await pathExists(globalConfigPath)) {
      if (options.quiet) {
        return {
          ok: false,
          error: {
            code: 'SETUP_REQUIRED',
            message: 'Global setup is required before init',
            retryable: true,
          },
        };
      }

      const runSetup = await confirm({
        message: 'Superplan is not set up on this machine.\nRun setup now?'
      });

      if (!runSetup) {
        return {
          ok: false,
          error: {
            code: 'SETUP_REQUIRED',
            message: 'Global setup is required before init',
            retryable: true,
          },
        };
      }

      const setupResult: SetupResult = await setup({ json: false, quiet: false });
      if (!setupResult.ok) {
        return setupResult;
      }

      if (!await pathExists(globalConfigPath)) {
        return {
          ok: false,
          error: {
            code: 'SETUP_REQUIRED',
            message: 'Global setup is required before init',
            retryable: true,
          },
        };
      }
    }

    if (await pathExists(superplanRoot)) {
      if (options.quiet) {
        return {
          ok: true,
          data: {
            root: '.superplan',
          },
        };
      }

      const reinitialize = await confirm({ message: 'Superplan already initialized. Reinitialize?' });
      if (!reinitialize) {
        return {
          ok: true,
          data: {
            root: '.superplan',
          },
        };
      }
    }

    await fs.mkdir(superplanRoot, { recursive: true });
    await fs.mkdir(contextDir, { recursive: true });
    await fs.mkdir(runtimeDir, { recursive: true });
    await fs.mkdir(changesDir, { recursive: true });
    await fs.writeFile(configPath, 'version = "0.1"\n', 'utf-8');

    return {
      ok: true,
      data: {
        root: '.superplan',
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
