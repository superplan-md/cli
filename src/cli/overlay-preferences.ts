import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { resolveWorkspaceRoot } from './workspace-root';

export type OverlayPreferenceScope = 'global' | 'local';

export interface OverlayPreferencePaths {
  globalConfigPath: string;
  localConfigPath: string;
  localRootPath: string;
}

export interface OverlayPreferenceState extends OverlayPreferencePaths {
  global_enabled: boolean | null;
  local_enabled: boolean | null;
  effective_enabled: boolean;
  effective_scope: OverlayPreferenceScope | null;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function getOverlayPreferencePaths(cwd = process.cwd()): OverlayPreferencePaths {
  const globalConfigPath = path.join(os.homedir(), '.config', 'superplan', 'config.toml');
  const localRootPath = path.join(resolveWorkspaceRoot(cwd), '.superplan');
  const localConfigPath = path.join(localRootPath, 'config.toml');

  return {
    globalConfigPath,
    localConfigPath,
    localRootPath,
  };
}

async function readConfigContent(configPath: string): Promise<string> {
  try {
    return await fs.readFile(configPath, 'utf-8');
  } catch {
    return '';
  }
}

function parseSectionHeader(line: string): string | null {
  const match = line.trim().match(/^\[([^\]]+)\]$/);
  return match ? match[1].trim() : null;
}

function parseBooleanSetting(content: string, sectionName: string, keyName: string): boolean | null {
  let currentSection: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    const sectionHeader = parseSectionHeader(line);
    if (sectionHeader) {
      currentSection = sectionHeader;
      continue;
    }

    if (currentSection !== sectionName) {
      continue;
    }

    const match = line.match(new RegExp(`^\\s*${keyName}\\s*=\\s*(true|false)\\s*$`));
    if (!match) {
      continue;
    }

    return match[1] === 'true';
  }

  return null;
}

function buildUpdatedConfigContent(content: string, sectionName: string, keyName: string, value: boolean): string {
  const lines = content === '' ? [] : content.split(/\r?\n/);
  const settingLine = `${keyName} = ${value ? 'true' : 'false'}`;

  if (lines.length === 0) {
    return `version = "0.1"\n\n[${sectionName}]\n${settingLine}\n`;
  }

  let currentSection: string | null = null;
  let sectionStart = -1;
  let sectionEnd = lines.length;
  let keyIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionHeader = parseSectionHeader(line);

    if (sectionHeader) {
      if (currentSection === sectionName && sectionEnd === lines.length) {
        sectionEnd = index;
      }

      currentSection = sectionHeader;
      if (sectionHeader === sectionName && sectionStart === -1) {
        sectionStart = index;
      }
      continue;
    }

    if (currentSection !== sectionName) {
      continue;
    }

    if (new RegExp(`^\\s*${keyName}\\s*=\\s*(true|false)\\s*$`).test(line)) {
      keyIndex = index;
    }
  }

  if (sectionStart === -1) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('');
    }

    lines.push(`[${sectionName}]`);
    lines.push(settingLine);
    return `${lines.join('\n').replace(/\n*$/, '')}\n`;
  }

  if (keyIndex !== -1) {
    lines[keyIndex] = settingLine;
    return `${lines.join('\n').replace(/\n*$/, '')}\n`;
  }

  lines.splice(sectionEnd, 0, settingLine);
  return `${lines.join('\n').replace(/\n*$/, '')}\n`;
}

export async function readOverlayPreferences(cwd = process.cwd()): Promise<OverlayPreferenceState> {
  const paths = getOverlayPreferencePaths(cwd);
  const [globalContent, localContent] = await Promise.all([
    readConfigContent(paths.globalConfigPath),
    readConfigContent(paths.localConfigPath),
  ]);

  const globalEnabled = parseBooleanSetting(globalContent, 'overlay', 'enabled');
  const localEnabled = parseBooleanSetting(localContent, 'overlay', 'enabled');
  const effectiveEnabled = localEnabled ?? globalEnabled ?? false;
  const effectiveScope = localEnabled !== null ? 'local' : (globalEnabled !== null ? 'global' : null);

  return {
    ...paths,
    global_enabled: globalEnabled,
    local_enabled: localEnabled,
    effective_enabled: effectiveEnabled,
    effective_scope: effectiveScope,
  };
}

export async function hasLocalSuperplanRoot(cwd = process.cwd()): Promise<boolean> {
  return pathExists(getOverlayPreferencePaths(cwd).localRootPath);
}

export async function writeOverlayPreference(
  enabled: boolean,
  options: { scope: OverlayPreferenceScope; cwd?: string },
): Promise<{ config_path: string; enabled: boolean }> {
  const cwd = options.cwd ?? process.cwd();
  const paths = getOverlayPreferencePaths(cwd);
  const configPath = options.scope === 'global' ? paths.globalConfigPath : paths.localConfigPath;
  const existingContent = await readConfigContent(configPath);
  const nextContent = buildUpdatedConfigContent(existingContent, 'overlay', 'enabled', enabled);

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, nextContent, 'utf-8');

  return {
    config_path: configPath,
    enabled,
  };
}
