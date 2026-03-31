import * as fs from 'fs/promises';
import * as path from 'path';

export async function writeJsonAtomic(targetPath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf-8');
  await fs.rename(tempPath, targetPath);
}

export async function readJsonFile<T>(targetPath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(targetPath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}
