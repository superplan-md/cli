import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'node:crypto';

export type TelemetryPreference = boolean | null;

export interface TelemetryConfig {
  enabled: TelemetryPreference;
  machineId: string | null;
}

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.config', 'superplan', 'config.toml');

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readConfigContent(): Promise<string> {
  try {
    return await fs.readFile(GLOBAL_CONFIG_PATH, 'utf-8');
  } catch {
    return '';
  }
}

function parseSectionHeader(line: string): string | null {
  const match = line.trim().match(/^\[([^\]]+)\]$/);
  return match ? match[1].trim() : null;
}

export async function readTelemetryConfig(): Promise<TelemetryConfig> {
  const content = await readConfigContent();
  let currentSection: string | null = null;
  let enabled: TelemetryPreference = null;
  let machineId: string | null = null;

  for (const line of content.split(/\r?\n/)) {
    const sectionHeader = parseSectionHeader(line);
    if (sectionHeader) {
      currentSection = sectionHeader;
      continue;
    }

    if (currentSection !== 'telemetry') {
      continue;
    }

    const enabledMatch = line.match(/^\s*enabled\s*=\s*(true|false)\s*$/);
    if (enabledMatch) {
      enabled = enabledMatch[1] === 'true';
    }

    const machineIdMatch = line.match(/^\s*machine_id\s*=\s*"([^"]+)"\s*$/);
    if (machineIdMatch) {
      machineId = machineIdMatch[1];
    }
  }

  return { enabled, machineId };
}

export async function writeTelemetryConfig(config: Partial<TelemetryConfig>): Promise<void> {
  const existingContent = await readConfigContent();
  let nextContent = existingContent;

  if (config.enabled !== undefined) {
    nextContent = buildUpdatedConfigContent(nextContent, 'telemetry', 'enabled', config.enabled === true ? 'true' : 'false');
  }

  if (config.machineId !== undefined) {
    nextContent = buildUpdatedConfigContent(nextContent, 'telemetry', 'machine_id', `"${config.machineId}"`);
  }

  await fs.mkdir(path.dirname(GLOBAL_CONFIG_PATH), { recursive: true });
  await fs.writeFile(GLOBAL_CONFIG_PATH, nextContent, 'utf-8');
}

function buildUpdatedConfigContent(content: string, sectionName: string, keyName: string, value: string): string {
  const lines = content === '' ? [] : content.split(/\r?\n/);
  const settingLine = `${keyName} = ${value}`;

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

    if (new RegExp(`^\\s*${keyName}\\s*=`).test(line)) {
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

export function generateMachineId(): string {
  // Use crypto.randomUUID() if available (Node 16+), else fallback
  try {
    return crypto.randomUUID();
  } catch {
    // Simple fallback for older Node if necessary
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
