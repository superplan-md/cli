import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  ensureWorkspaceArtifacts,
  getWorkspaceArtifactPaths,
  ensureChangeArtifacts,
  getChangeArtifactPaths,
} from './workspace-artifacts';

const GLOBAL_SUPERPLAN_DIR = path.join(os.homedir(), '.config', 'superplan');
const AGENTS_REGISTRY_FILE = path.join(GLOBAL_SUPERPLAN_DIR, 'agents.json');

export interface AgentRegistry {
  agents: string[];
  installed_at: string;
  last_updated: string;
}

export interface GlobalSuperplanPaths {
  superplanRoot: string;
  changesDir: string;
  runtimeDir: string;
  contextDir: string;
  agentsRegistryPath: string;
  decisionsPath: string;
  gotchasPath: string;
  contextIndexPath: string;
}

export function getGlobalSuperplanPaths(): GlobalSuperplanPaths {
  return {
    superplanRoot: GLOBAL_SUPERPLAN_DIR,
    changesDir: path.join(GLOBAL_SUPERPLAN_DIR, 'changes'),
    runtimeDir: path.join(GLOBAL_SUPERPLAN_DIR, 'runtime'),
    contextDir: path.join(GLOBAL_SUPERPLAN_DIR, 'context'),
    agentsRegistryPath: AGENTS_REGISTRY_FILE,
    decisionsPath: path.join(GLOBAL_SUPERPLAN_DIR, 'decisions.md'),
    gotchasPath: path.join(GLOBAL_SUPERPLAN_DIR, 'gotchas.md'),
    contextIndexPath: path.join(GLOBAL_SUPERPLAN_DIR, 'context', 'INDEX.md'),
  };
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureGlobalSuperplanDir(): Promise<void> {
  const paths = getGlobalSuperplanPaths();
  await fs.mkdir(paths.superplanRoot, { recursive: true });
  await fs.mkdir(paths.changesDir, { recursive: true });
  await fs.mkdir(paths.runtimeDir, { recursive: true });
  await fs.mkdir(paths.contextDir, { recursive: true });
}

export async function readAgentRegistry(): Promise<AgentRegistry | null> {
  try {
    const content = await fs.readFile(AGENTS_REGISTRY_FILE, 'utf-8');
    return JSON.parse(content) as AgentRegistry;
  } catch {
    return null;
  }
}

export async function writeAgentRegistry(agents: string[]): Promise<void> {
  const existing = await readAgentRegistry();
  const registry: AgentRegistry = {
    agents: [...new Set(agents)].sort(),
    installed_at: existing?.installed_at ?? new Date().toISOString(),
    last_updated: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(AGENTS_REGISTRY_FILE), { recursive: true });
  await fs.writeFile(AGENTS_REGISTRY_FILE, JSON.stringify(registry, null, 2), 'utf-8');
}

export async function addAgentsToRegistry(agentNames: string[]): Promise<void> {
  const existing = await readAgentRegistry();
  const currentAgents = existing?.agents ?? [];
  const updatedAgents = [...new Set([...currentAgents, ...agentNames])].sort();
  await writeAgentRegistry(updatedAgents);
}

export async function removeAgentsFromRegistry(agentNames: string[]): Promise<void> {
  const existing = await readAgentRegistry();
  if (!existing) return;
  const updatedAgents = existing.agents.filter(a => !agentNames.includes(a));
  await writeAgentRegistry(updatedAgents);
}

export async function isAgentInRegistry(agentName: string): Promise<boolean> {
  const registry = await readAgentRegistry();
  return registry?.agents.includes(agentName) ?? false;
}

export async function getInstalledAgentsFromRegistry(): Promise<string[]> {
  const registry = await readAgentRegistry();
  return registry?.agents ?? [];
}

export async function hasGlobalSuperplan(): Promise<boolean> {
  return await pathExists(GLOBAL_SUPERPLAN_DIR);
}

export function getCurrentDirName(): string {
  return path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9]/g, '-');
}

export async function ensureGlobalWorkspaceArtifacts(): Promise<string[]> {
  await ensureGlobalSuperplanDir();
  return await ensureWorkspaceArtifacts(GLOBAL_SUPERPLAN_DIR);
}

export async function ensureGlobalChangeArtifacts(changeSlug: string, title: string): Promise<string[]> {
  const changeRoot = path.join(getGlobalSuperplanPaths().changesDir, changeSlug);
  return await ensureChangeArtifacts(changeRoot, changeSlug, title);
}
