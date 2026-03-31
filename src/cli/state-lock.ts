import * as fs from 'fs/promises';
import * as path from 'path';
import { resolveSuperplanRoot } from './workspace-root';

const LOCK_FILE_NAME = '.project-state.lock';
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function pruneStaleLock(lockPath: string): Promise<void> {
  try {
    const stats = await fs.stat(lockPath);
    if (Date.now() - stats.mtimeMs <= LOCK_STALE_MS) {
      return;
    }

    await fs.rm(lockPath, { force: true });
  } catch {}
}

async function acquireLock(lockPath: string): Promise<fs.FileHandle> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (true) {
    try {
      await fs.mkdir(path.dirname(lockPath), { recursive: true });
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(JSON.stringify({
        pid: process.pid,
        created_at: new Date().toISOString(),
      }, null, 2), 'utf-8');
      return handle;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      await pruneStaleLock(lockPath);
      if (!await pathExists(lockPath)) {
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for project state lock at ${lockPath}`);
      }

      await sleep(LOCK_RETRY_MS);
    }
  }
}

export async function withProjectStateLock<T>(
  callback: () => Promise<T>,
  startDir = process.cwd(),
): Promise<T> {
  const lockPath = path.join(resolveSuperplanRoot(startDir), 'runtime', LOCK_FILE_NAME);
  const handle = await acquireLock(lockPath);

  try {
    return await callback();
  } finally {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
  }
}

export function getProjectStateLockPath(startDir = process.cwd()): string {
  return path.join(resolveSuperplanRoot(startDir), 'runtime', LOCK_FILE_NAME);
}
