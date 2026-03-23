import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { confirm, select, checkbox } from '@inquirer/prompts';
import { getBootstrapStrengthSummary } from '../agent-integrations';
import { readInstallMetadata, getInstallMetadataPath, type InstallMetadata } from '../install-metadata';
import { writeOverlayPreference } from '../overlay-preferences';
import { CURRENT_ENTRY_SKILL_NAME, LEGACY_SUPERPLAN_SKILL_NAMES } from '../skill-names';
import { resolveWorkspaceRoot } from '../workspace-root';
import { ensureWorkspaceArtifacts } from '../workspace-artifacts';

interface AgentEnvironment {
  name: string;
  path: string;
  install_path: string;
  install_kind: 'toml_command' | 'skills_namespace' | 'pointer_rule' | 'markdown_rule' | 'managed_global_rule';
  bootstrap_strength?: 'context_bootstrap' | 'rule_bootstrap' | 'skills_only';
  cleanup_paths?: string[];
  global_skills_dir?: string;
  detected?: boolean;
}

type InstallScope = 'global' | 'local' | 'both' | 'skip';
type AgentScope = 'project' | 'global';

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  amazonq: 'Amazon Q',
  antigravity: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
};

const AGENT_SELECTION_ORDER = ['claude', 'codex', 'gemini', 'cursor', 'opencode', 'amazonq', 'antigravity'];
const SELECT_ALL_AGENTS_VALUE = '__all_agents__';

export interface InitOptions {
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
  scope?: InstallScope;
}

export interface RefreshInstalledSkillsOptions {
  cwd?: string;
  homeDir?: string;
  sourceSkillsDir?: string;
}

export type InitResult =
  | {
      ok: true;
      data: {
        config_path: string;
        skills_path: string;
        scope: InstallScope;
        agents: AgentEnvironment[];
        message?: string;
        verified?: boolean;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export type RefreshInstalledSkillsResult =
  | {
      ok: true;
      data: {
        scope: InstallScope;
        agents: AgentEnvironment[];
        verified: true;
        refreshed: boolean;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

interface VerificationIssue {
  code: string;
  message: string;
}

const SETUP_BANNER = `
 ____  _   _ ____  _____ ____  ____  _        _    _   _
/ ___|| | | |  _ \\| ____|  _ \\|  _ \\| |      / \\  | \\ | |
\\___ \\| | | | |_) |  _| | |_) | |_) | |     / _ \\ |  \\| |
 ___) | |_| |  __/| |___|  _ <|  __/| |___ / ___ \\| |\\  |
|____/ \\___/|_|   |_____|_| \\_\\_|   |_____/_/   \\_\\_| \\_|

`;
const MANAGED_ANTIGRAVITY_BLOCK_START = '<!-- superplan-antigravity:start -->';
const MANAGED_ANTIGRAVITY_BLOCK_END = '<!-- superplan-antigravity:end -->';
const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START = '<!-- superplan-entry-instructions:start -->';
const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END = '<!-- superplan-entry-instructions:end -->';

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function directoryHasAtLeastOneFile(dirPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);

      if (entry.isFile()) {
        return true;
      }

      if (entry.isDirectory() && await directoryHasAtLeastOneFile(entryPath)) {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

async function ensureGlobalConfig(configPath: string): Promise<void> {
  const initialConfig = `version = "0.1"\n\n[agents]\ninstalled = []\n`;
  await fs.writeFile(configPath, initialConfig, 'utf-8');
}

async function ensureLocalConfig(configPath: string): Promise<void> {
  await fs.writeFile(configPath, 'version = "0.1"\n', 'utf-8');
}

async function installSkills(sourceDir: string, targetDir: string): Promise<void> {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  const stats = await fs.stat(sourceDir);
  if (stats.isDirectory()) {
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
  }
}

export function getInitCommandHelpMessage(invalidScope?: string): string {
  const intro = invalidScope
    ? `Invalid init scope: ${invalidScope}`
    : 'Init installs Superplan, configures AI agents, and scaffolds the repository.';

  return [
    intro,
    '',
    'Usage:',
    '  superplan init --scope <local|global|both|skip> --yes --json',
    '  superplan init                 # interactive mode',
    '',
    'Options:',
    '  --scope <scope>   local, global, both, or skip',
    '  --yes             confirm actions without prompting',
    '  --quiet           non-interactive mode with default choices',
    '  --json            return structured output',
    '',
    'Examples:',
    '  superplan init --scope local --yes --json',
    '  superplan init --scope global --quiet',
  ].join('\n');
}

function getPointerRuleContent(globalSkillsDir: string): string {
  const skillNames = [
    'superplan-entry',
    'superplan-route',
    'superplan-shape',
    'superplan-execute',
    'superplan-review',
    'superplan-context',
    'superplan-brainstorm',
    'superplan-plan',
    'superplan-debug',
    'superplan-tdd',
    'superplan-verify',
    'superplan-guard',
    'superplan-handoff',
    'superplan-postmortem',
    'superplan-release',
    'superplan-docs',
  ];

  const skillList = skillNames
    .map(name => `- \`${name}\`: read \`${path.join(globalSkillsDir, name, 'SKILL.md')}\``)
    .join('\n');

  return `# Superplan – Global Skills Pointer

This repository uses Superplan as its task execution control plane.
All Superplan workflow skills are installed globally on this machine.

## Critical Rule

Before making ANY code changes or proposing any plan:
- Run \`superplan status --json\` to check current state.
- If a \`.superplan\` directory exists, you ARE in a structured workflow.
- Claim work with \`superplan run --json\` before editing code.
- Use the CLI for all lifecycle transitions (block, feedback, complete).
- Never hand-edit \`.superplan/runtime/\` files.

## Global Skills Directory

**Skills are installed at**: \`${globalSkillsDir}\`

Read the top-level principles file first:
- \`${path.join(globalSkillsDir, '00-superplan-principles.md')}\`

Then read the relevant skill for the current workflow phase:

${skillList}

## How To Use

1. For every query that involves repo work, read \`${path.join(globalSkillsDir, 'superplan-entry', 'SKILL.md')}\` to determine the correct workflow phase.
2. Follow the routing instructions in that skill to reach the appropriate next skill.
3. Each skill's \`SKILL.md\` contains full instructions, triggers, and CLI commands.
4. Also check the \`references/\` subdirectory inside each skill for additional guidance when available.
`;
}

function getAntigravityWorkspaceRuleContent(skillPath: string): string {
  return `# Superplan Entry Rule

Always treat this rule as active for repo work.

Before implementation, broad repo exploration, or clarifying questions for repo-work requests, load and follow:

@${skillPath}
`;
}

function getAntigravityGlobalRuleBlock(skillPath: string): string {
  return `${MANAGED_ANTIGRAVITY_BLOCK_START}
# Superplan Entry Rule

Always treat this rule as active for repo work.

Before implementation, broad repo exploration, or clarifying questions for repo-work requests, load and follow:

@${skillPath}
${MANAGED_ANTIGRAVITY_BLOCK_END}`;
}

function upsertManagedBlock(existingContent: string, block: string, startMarker: string, endMarker: string): string {
  const blockPattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`, 'm');
  if (blockPattern.test(existingContent)) {
    return existingContent.replace(blockPattern, block);
  }

  const trimmed = existingContent.trimEnd();
  if (!trimmed) {
    return `${block}\n`;
  }

  return `${trimmed}\n\n${block}\n`;
}

function getManagedEntryInstructionsBlock(): string {
  return `${MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START}
When working in this repository, before implementation, broad repo exploration, or clarifying questions for repo work, you must load and follow the \`superplan-entry\` skill to begin your work.
${MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END}`;
}

async function installManagedInstructionsFile(targetPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const existingContent = await fs.readFile(targetPath, 'utf-8').catch(() => '');
  const nextContent = upsertManagedBlock(
    existingContent,
    getManagedEntryInstructionsBlock(),
    MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START,
    MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END,
  );
  await fs.writeFile(targetPath, nextContent, 'utf-8');
}

async function installAntigravityWorkspaceRule(targetPath: string, skillPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, getAntigravityWorkspaceRuleContent(skillPath), 'utf-8');
}

async function installAntigravityGlobalRule(targetPath: string, skillPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const existingContent = await fs.readFile(targetPath, 'utf-8').catch(() => '');
  const nextContent = upsertManagedBlock(
    existingContent,
    getAntigravityGlobalRuleBlock(skillPath),
    MANAGED_ANTIGRAVITY_BLOCK_START,
    MANAGED_ANTIGRAVITY_BLOCK_END,
  );
  await fs.writeFile(targetPath, nextContent, 'utf-8');
}


async function installSkillsNamespace(sourceDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  // Remove the legacy bundled Superplan skill entry before installing peer skills.
  await fs.rm(path.join(targetDir, 'superplan'), { recursive: true, force: true });
  for (const legacySkillName of LEGACY_SUPERPLAN_SKILL_NAMES) {
    await fs.rm(path.join(targetDir, legacySkillName), { recursive: true, force: true });
  }

  for (const entry of entries) {
    if (entry.name === 'SKILL.md') {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    await fs.rm(targetPath, { recursive: true, force: true });

    if (entry.isDirectory()) {
      await fs.cp(sourcePath, targetPath, { recursive: true, force: true });
    } else {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

function getGeminiCommandContent(): string {
  return `description = "Use Superplan as the task execution control plane for this repository"

prompt = """
Use the Superplan CLI in this repository as the source of truth for task state.

Common commands:
- \`superplan context bootstrap --json\`
- \`superplan context status --json\`
- \`superplan change new <change-slug> --json\`
- \`superplan validate <change-slug> --json\`
- \`superplan task new <change-slug> --task-id <task_id> --json\`
- \`superplan task batch <change-slug> --stdin --json\`
- \`superplan status --json\`
- \`superplan run --json\`
- \`superplan run <task_id> --json\`
- \`superplan task show <task_id> --json\`
- \`superplan task block <task_id> --reason "<reason>" --json\`
- \`superplan task request-feedback <task_id> --message "<message>" --json\`
- \`superplan task complete <task_id> --json\`
- \`superplan task fix --json\`
- \`superplan doctor --json\`
- \`superplan overlay ensure --json\`
- \`superplan overlay hide --json\`

Execution loop:
1. Check \`superplan status --json\`
2. Claim work with \`superplan run --json\`
3. Use the task returned by \`superplan run --json\` before editing code; use \`superplan run <task_id> --json\` when one known ready or paused task should become active; reach for \`superplan task show <task_id> --json\` only when you need one task's full details and readiness reasons
4. Update runtime state with block, feedback, complete, or fix commands instead of editing markdown state by hand
5. After implementation proof passes, do not end the turn with the task still effectively pending or in progress; move it through \`superplan task complete <task_id> --json\` and the appropriate review path, or state the exact blocker
6. Use \`superplan context bootstrap --json\` when durable workspace context entrypoints are missing, then keep \`.superplan/context/\`, \`.superplan/decisions.md\`, \`.superplan/gotchas.md\`, and \`.superplan/plan.md\` honest instead of inventing ad hoc files
7. When shaping tracked work, author the graph in \`.superplan/changes/<change-slug>/tasks.md\` first, run \`superplan validate <change-slug> --json\`, then scaffold contracts by graph-declared task id instead of hand-creating \`tasks/T-xxx.md\`
8. When the request is large, ambiguous, or multi-workstream, do not jump straight from the raw request into task scaffolding; clarify expectations, capture spec or plan truth when needed, then finalize the graph
9. If overlay support is enabled for this workspace and a launchable companion is installed, \`superplan task new\`, \`superplan task batch\`, \`superplan run\`, \`superplan run <task_id>\`, and \`superplan task reopen\` can auto-reveal the overlay when work becomes visible; on a fresh machine or after install/update, verify overlay health with \`superplan doctor --json\` and \`superplan overlay ensure --json\` before assuming it is working, and inspect launchability or companion errors if the reveal fails; use \`superplan overlay hide --json\` when it becomes idle or empty
10. After overlay-triggering commands, inspect the returned \`overlay\` payload; if \`overlay.companion.launched\` is false, surface \`overlay.companion.reason\` instead of assuming the overlay appeared

Authoring rule:
- Use \`superplan context bootstrap --json\` to create missing workspace context entrypoints instead of hand-writing them from scratch
- Use \`superplan change new <change-slug> --json\` once per tracked change
- Let \`superplan change new\` scaffold the tracked change root, including spec surfaces, before filling in graph truth
- Author the root \`.superplan/changes/<change-slug>/tasks.md\` manually as graph truth; the shell-loop prohibition applies to task-contract generation and bulk graph rewrites, not to normal manual graph authoring
- Never create or edit \`.superplan/changes/<change-slug>/tasks/T-xxx.md\` task contracts with shell loops or direct file-edit rewrites such as \`for\`, \`sed\`, \`cat > ...\`, \`printf > ...\`, here-docs, or ad hoc batch rewrites; shell is only acceptable here as stdin transport into \`superplan task batch --stdin --json\`
- When the request is large, ambiguous, or multi-workstream, do not jump straight from the raw request into task scaffolding; capture clarification, spec, or plan truth first, then finalize the graph
- Author \`.superplan/changes/<change-slug>/tasks.md\` manually as graph truth, then run \`superplan validate <change-slug> --json\` before scaffolding task contracts
- Use \`superplan task new <change-slug> --task-id <task_id> --json\` only when exactly one graph-declared task contract should be created now
- Use \`superplan task batch --stdin --json\` when two or more graph-declared task contracts are ready to be scaffolded in one pass
- Prefer stdin over temp files in agent flows
- Use the returned task payloads directly after authoring instead of immediately calling \`superplan task show\`

Canonical selection rule:
- Prefer the one canonical command for the intent instead of choosing among overlapping alternatives
- Prefer commands that already return the needed task payload instead of making extra follow-up calls

User communication rule:
- Keep workflow control and command-by-command orchestration internal unless the user explicitly asks for it
- Do not narrate meta progress such as which Superplan skill is active, that routing or shaping is happening, or lists of explored files and commands
- Progress updates should focus on user value: what is changing, what risk is being checked, what decision matters, or what blocker needs attention
- Prefer project thoughts over process thoughts

Never write \`.superplan/runtime/overlay.json\` by hand.
"""`;
}

function getAgentDisplayName(agent: AgentEnvironment): string {
  return AGENT_DISPLAY_NAMES[agent.name] ?? agent.name;
}

function sortAgentsForSelection(agents: AgentEnvironment[]): AgentEnvironment[] {
  return [...agents].sort((left, right) => {
    const leftIndex = AGENT_SELECTION_ORDER.indexOf(left.name);
    const rightIndex = AGENT_SELECTION_ORDER.indexOf(right.name);
    const normalizedLeftIndex = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const normalizedRightIndex = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;

    if (normalizedLeftIndex !== normalizedRightIndex) {
      return normalizedLeftIndex - normalizedRightIndex;
    }

    return getAgentDisplayName(left).localeCompare(getAgentDisplayName(right));
  });
}

function formatDetectedAgentInstructions(agents: AgentEnvironment[]): string {
  const foundAgentNames = agents.map(getAgentDisplayName).join(', ');
  return `\n! Found: ${foundAgentNames}\n! Space = select, Enter = continue`;
}

function getAgentDefinitions(baseDir: string, scope: AgentScope): AgentEnvironment[] {
  if (scope === 'project') {
    return [
      {
        name: 'claude',
        path: path.join(baseDir, '.claude'),
        install_path: path.join(baseDir, '.claude', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [path.join(baseDir, '.claude', 'commands', 'superplan.md')],
      },
      {
        name: 'gemini',
        path: path.join(baseDir, '.gemini'),
        install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
        install_kind: 'toml_command',
        bootstrap_strength: 'context_bootstrap',
      },
      {
        name: 'cursor',
        path: path.join(baseDir, '.cursor'),
        install_path: path.join(baseDir, '.cursor', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [path.join(baseDir, '.cursor', 'commands', 'superplan.md')],
      },
      {
        name: 'codex',
        path: path.join(baseDir, '.codex'),
        install_path: path.join(baseDir, '.codex', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [path.join(baseDir, '.codex', 'skills', 'superplan')],
      },
      {
        name: 'opencode',
        path: path.join(baseDir, '.opencode'),
        install_path: path.join(baseDir, '.opencode', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [path.join(baseDir, '.opencode', 'commands', 'superplan.md')],
      },
      {
        name: 'amazonq',
        path: path.join(baseDir, '.amazonq'),
        install_path: path.join(baseDir, '.amazonq', 'rules', 'superplan.md'),
        install_kind: 'pointer_rule',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.amazonq', 'rules', 'superplan'),
          path.join(baseDir, '.amazonq', 'rules', 'superplan-entry'),
        ],
        global_skills_dir: path.join(os.homedir(), '.config', 'superplan', 'skills'),
      },
      {
        name: 'antigravity',
        path: path.join(baseDir, '.agents'),
        install_path: path.join(baseDir, '.agents', 'rules', 'superplan-entry.md'),
        install_kind: 'markdown_rule',
        bootstrap_strength: 'rule_bootstrap',
      },
    ];
  }

  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      install_path: path.join(baseDir, '.claude', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [path.join(baseDir, '.claude', 'commands', 'superplan.md')],
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
      install_kind: 'toml_command',
      bootstrap_strength: 'context_bootstrap',
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      install_path: path.join(baseDir, '.cursor', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [path.join(baseDir, '.cursor', 'commands', 'superplan.md')],
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      install_path: path.join(baseDir, '.codex', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [path.join(baseDir, '.codex', 'skills', 'superplan')],
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.config', 'opencode'),
      install_path: path.join(baseDir, '.config', 'opencode', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [path.join(baseDir, '.config', 'opencode', 'commands', 'superplan.md')],
    },

    {
      name: 'antigravity',
      path: path.join(baseDir, '.gemini'),
      install_path: path.join(baseDir, '.gemini', 'GEMINI.md'),
      install_kind: 'managed_global_rule',
      bootstrap_strength: 'rule_bootstrap',
    },
  ];
}

async function detectVSCodeExtensions(): Promise<Set<string>> {
  const detected = new Set<string>();
  const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');

  try {
    const entries = await fs.readdir(extensionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const name = entry.name.toLowerCase();
      if (name.startsWith('amazonwebservices.amazon-q-vscode')) detected.add('amazonq');
      if (name.startsWith('anthropic.claude-code')) detected.add('claude');
      if (name.startsWith('google.gemini-cli-vscode')) detected.add('gemini');
      if (name.startsWith('openai.chatgpt')) detected.add('codex');
    }
  } catch {
    // Ignore errors if directory doesn't exist
  }

  return detected;
}

async function detectAgents(baseDir: string, scope: AgentScope): Promise<AgentEnvironment[]> {
  const definitions = getAgentDefinitions(baseDir, scope);
  const extensions = await detectVSCodeExtensions();
  
  for (const agent of definitions) {
    const hasConfigDir = await pathExists(agent.path);
    const hasExtension = extensions.has(agent.name);
    agent.detected = hasConfigDir || hasExtension;
  }
  
  return definitions;
}

async function installOverlayCompanion(globalConfigDir: string): Promise<void> {
  const repoRoot = path.resolve(__dirname, '../../..');
  const platform = process.platform;
  let sourceBundlePath: string | null = null;
  let targetBundleName: string | null = null;
  let executableRelativePath: string | null = null;

  if (platform === 'darwin') {
    sourceBundlePath = path.join(
      repoRoot,
      'apps',
      'overlay-desktop',
      'src-tauri',
      'target',
      'release',
      'bundle',
      'macos',
      'Superplan Overlay Desktop.app',
    );
    targetBundleName = 'Superplan Overlay Desktop.app';
    executableRelativePath = 'Contents/MacOS/superplan-overlay-desktop';
  } else if (platform === 'linux') {
    // Search for AppImage
    const appImageDir = path.join(
      repoRoot,
      'apps',
      'overlay-desktop',
      'src-tauri',
      'target',
      'release',
      'bundle',
      'appimage',
    );
    if (await pathExists(appImageDir)) {
      const entries = await fs.readdir(appImageDir);
      const appImage = entries.find(e => e.endsWith('.AppImage'));
      if (appImage) {
        sourceBundlePath = path.join(appImageDir, appImage);
        targetBundleName = 'superplan-overlay.AppImage';
      }
    }
  }

  if (sourceBundlePath && await pathExists(sourceBundlePath)) {
    const binDir = path.join(globalConfigDir, 'bin');
    await fs.mkdir(binDir, { recursive: true });
    const targetPath = path.join(binDir, targetBundleName!);

    await fs.rm(targetPath, { recursive: true, force: true });

    if (platform === 'darwin') {
      await fs.cp(sourceBundlePath, targetPath, { recursive: true });
    } else {
      await fs.copyFile(sourceBundlePath, targetPath);
      await fs.chmod(targetPath, 0o755);
    }

    const installMetadataPath = getInstallMetadataPath();
    const existingMetadata = await readInstallMetadata();
    const nextMetadata: InstallMetadata = {
      ...existingMetadata,
      overlay: {
        install_method: 'copied_prebuilt',
        install_path: targetPath,
        executable_path: executableRelativePath ? path.join(targetPath, executableRelativePath) : targetPath,
        installed_at: new Date().toISOString(),
      },
    };

    await fs.writeFile(installMetadataPath, JSON.stringify(nextMetadata, null, 2), 'utf-8');
  }
}

async function installAgentSkills(skillsDir: string, agents: AgentEnvironment[]): Promise<void> {
  for (const agent of agents) {
    if (agent.install_kind === 'skills_namespace') {
      await installSkillsNamespace(skillsDir, agent.install_path);

      for (const cleanupPath of agent.cleanup_paths ?? []) {
        await fs.rm(cleanupPath, { recursive: true, force: true });
      }

      continue;
    }

    if (agent.install_kind === 'pointer_rule') {
      const globalSkillsDir = agent.global_skills_dir ?? path.join(os.homedir(), '.config', 'superplan', 'skills');

      for (const cleanupPath of agent.cleanup_paths ?? []) {
        await fs.rm(cleanupPath, { recursive: true, force: true });
      }

      await fs.mkdir(path.dirname(agent.install_path), { recursive: true });
      await fs.writeFile(agent.install_path, getPointerRuleContent(globalSkillsDir), 'utf-8');
      continue;
    }

    if (agent.install_kind === 'markdown_rule') {
      const antigravitySkillPath = path.join(skillsDir, CURRENT_ENTRY_SKILL_NAME, 'SKILL.md');
      await installAntigravityWorkspaceRule(agent.install_path, antigravitySkillPath);
      continue;
    }

    if (agent.install_kind === 'managed_global_rule') {
      const antigravitySkillPath = path.join(skillsDir, CURRENT_ENTRY_SKILL_NAME, 'SKILL.md');
      await installAntigravityGlobalRule(agent.install_path, antigravitySkillPath);
      continue;
    }

    await fs.mkdir(path.dirname(agent.install_path), { recursive: true });
    await fs.writeFile(agent.install_path, getGeminiCommandContent(), 'utf-8');
  }
}

async function promptForAgentSelection(
  message: string,
  detectedAgents: AgentEnvironment[],
): Promise<AgentEnvironment[]> {
  const orderedAgents = sortAgentsForSelection(detectedAgents);
  if (orderedAgents.length === 0) {
    return [];
  }

  const selectedAgentNames = new Set(await checkbox<string>({
    message,
    required: true,
    instructions: formatDetectedAgentInstructions(orderedAgents.filter(a => a.detected)),
    theme: {
      icon: {
        checked: '[x]',
        unchecked: '[ ]',
      },
    },
    validate: choices => choices.length > 0 || 'Select at least one agent integration to continue.',
    choices: [
      ...orderedAgents.map(agent => ({
        name: getAgentDisplayName(agent),
        value: agent.name,
        checked: agent.detected ?? false,
      })),
      ...(orderedAgents.length > 1
        ? [{
            name: 'Select all found AI agents',
            value: SELECT_ALL_AGENTS_VALUE,
            checked: false,
          }]
        : []),
    ],
  }));

  if (selectedAgentNames.has(SELECT_ALL_AGENTS_VALUE)) {
    return orderedAgents;
  }

  return orderedAgents.filter(agent => selectedAgentNames.has(agent.name));
}

async function ensureSkillsSource(
  sourceDir: string,
): Promise<{ ok: false; error: { code: string; message: string; retryable: boolean } } | null> {
  try {
    const stats = await fs.stat(sourceDir);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        error: {
          code: 'SKILLS_SOURCE_MISSING',
          message: 'Bundled skills folder not found in CLI package',
          retryable: false,
        },
      };
    }
  } catch {
    return {
      ok: false,
      error: {
        code: 'SKILLS_SOURCE_MISSING',
        message: 'Bundled skills folder not found in CLI package',
        retryable: false,
      },
    };
  }

  return null;
}

async function ensureGlobalSetup(
  configDir: string,
  configPath: string,
  skillsDir: string,
  sourceSkillsDir: string,
  homeDir: string,
): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });

  if (!await pathExists(configPath)) {
    await ensureGlobalConfig(configPath);
  }

  await installSkills(sourceSkillsDir, skillsDir);
  if (await pathExists(path.join(homeDir, '.codex'))) {
    await installManagedInstructionsFile(path.join(homeDir, '.codex', 'AGENTS.md'));
  }

  if (await pathExists(path.join(homeDir, '.claude'))) {
    await installManagedInstructionsFile(path.join(homeDir, '.claude', 'CLAUDE.md'));
  }
}

async function ensureLocalSetup(
  superplanDir: string,
  configPath: string,
  skillsDir: string,
  changesDir: string,
  sourceSkillsDir: string,
  workspaceRoot: string,
): Promise<void> {
  await fs.mkdir(superplanDir, { recursive: true });
  await fs.mkdir(changesDir, { recursive: true });

  if (!await pathExists(configPath)) {
    await ensureLocalConfig(configPath);
  }

  await installSkills(sourceSkillsDir, skillsDir);
  await installManagedInstructionsFile(path.join(workspaceRoot, 'AGENTS.md'));
  await installManagedInstructionsFile(path.join(workspaceRoot, 'CLAUDE.md'));
}

function getScopePaths(scope: InstallScope, globalConfigPath: string, globalSkillsPath: string, localConfigPath: string, localSkillsPath: string) {
  if (scope === 'local') {
    return {
      config_path: localConfigPath,
      skills_path: localSkillsPath,
    };
  }

  if (scope === 'skip') {
    return {
      config_path: '',
      skills_path: '',
    };
  }

  return {
    config_path: globalConfigPath,
    skills_path: globalSkillsPath,
  };
}

function getAgentVerificationPath(agent: AgentEnvironment): string {
  if (agent.install_kind === 'skills_namespace') {
    return path.join(agent.install_path, CURRENT_ENTRY_SKILL_NAME, 'SKILL.md');
  }

  // pointer_rule and toml_command both verify the install_path file directly
  return agent.install_path;
}

async function verifySetup(scope: InstallScope, paths: {
  globalConfigPath: string;
  globalSkillsDir: string;
  localConfigPath: string;
  localSkillsDir: string;
  localChangesDir: string;
  homeAgents: AgentEnvironment[];
  repoAgents: AgentEnvironment[];
}): Promise<VerificationIssue[]> {
  const issues: VerificationIssue[] = [];

  if (scope === 'global' || scope === 'both') {
    if (!await pathExists(paths.globalConfigPath)) {
      issues.push({
        code: 'GLOBAL_CONFIG_MISSING',
        message: 'Global config was not installed correctly.',
      });
    }

    const globalSkillsInstalled = await pathExists(paths.globalSkillsDir)
      && await directoryHasAtLeastOneFile(paths.globalSkillsDir);
    if (!globalSkillsInstalled) {
      issues.push({
        code: 'GLOBAL_SKILLS_MISSING',
        message: 'Global skills were not installed correctly.',
      });
    }

    for (const agent of paths.homeAgents) {
      if (!await pathExists(getAgentVerificationPath(agent))) {
        issues.push({
          code: 'GLOBAL_AGENT_INSTALL_MISSING',
          message: `Global ${agent.name} integration was not installed correctly.`,
        });
      }
    }
  }

  if (scope === 'local' || scope === 'both') {
    if (!await pathExists(paths.localConfigPath)) {
      issues.push({
        code: 'LOCAL_CONFIG_MISSING',
        message: 'Local config was not installed correctly.',
      });
    }

    const localSkillsInstalled = await pathExists(paths.localSkillsDir)
      && await directoryHasAtLeastOneFile(paths.localSkillsDir);
    if (!localSkillsInstalled) {
      issues.push({
        code: 'LOCAL_SKILLS_MISSING',
        message: 'Local skills were not installed correctly.',
      });
    }

    if (!await pathExists(paths.localChangesDir)) {
      issues.push({
        code: 'LOCAL_CHANGES_MISSING',
        message: 'Local changes directory was not created correctly.',
      });
    }

    for (const agent of paths.repoAgents) {
      if (!await pathExists(getAgentVerificationPath(agent))) {
        issues.push({
          code: 'LOCAL_AGENT_INSTALL_MISSING',
          message: `Local ${agent.name} integration was not installed correctly.`,
        });
      }
    }
  }

  return issues;
}

function getNoAgentsMessage(scope: InstallScope, agentCount: number): string | undefined {
  if (agentCount > 0 || scope === 'skip') {
    return undefined;
  }

  if (scope === 'local') {
    return 'No agent environments found in this repo.';
  }

  if (scope === 'global') {
    return 'No agent environments found in your home directory.';
  }

  return 'No agent environments found in this repo or your home directory.';
}

function isInstallScope(value: string | undefined): value is InstallScope {
  return value === 'global' || value === 'local' || value === 'both' || value === 'skip';
}

function printSetupBanner(): void {
  console.log(SETUP_BANNER);
}

export async function refreshInstalledSkills(
  options: RefreshInstalledSkillsOptions = {},
): Promise<RefreshInstalledSkillsResult> {
  try {
    const cwd = options.cwd ?? process.cwd();
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const homeDir = options.homeDir ?? os.homedir();
    const sourceSkillsDir = options.sourceSkillsDir ?? path.resolve(__dirname, '../../skills');

    const globalConfigDir = path.join(homeDir, '.config', 'superplan');
    const globalConfigPath = path.join(globalConfigDir, 'config.toml');
    const globalSkillsDir = path.join(globalConfigDir, 'skills');

    const localSuperplanDir = path.join(workspaceRoot, '.superplan');
    const localConfigPath = path.join(localSuperplanDir, 'config.toml');
    const localSkillsDir = path.join(localSuperplanDir, 'skills');
    const localChangesDir = path.join(localSuperplanDir, 'changes');

    const hasGlobalSetup = await pathExists(globalConfigPath) || await pathExists(globalSkillsDir);
    const hasLocalSetup = await pathExists(localConfigPath) || await pathExists(localSkillsDir);

    const scope: InstallScope = hasGlobalSetup && hasLocalSetup
      ? 'both'
      : hasGlobalSetup
        ? 'global'
        : hasLocalSetup
          ? 'local'
          : 'skip';

    if (scope === 'skip') {
      return {
        ok: true,
        data: {
          scope,
          agents: [],
          verified: true,
          refreshed: false,
        },
      };
    }

    const skillsSourceError = await ensureSkillsSource(sourceSkillsDir);
    if (skillsSourceError) {
      return {
        ok: false,
        error: skillsSourceError.error,
      };
    }

    const repoAgents = scope === 'local' || scope === 'both'
      ? await detectAgents(workspaceRoot, 'project')
      : [];
    const homeAgents = scope === 'global' || scope === 'both'
      ? await detectAgents(homeDir, 'global')
      : [];

    // Always ensure global config and skills exist regardless of scope.
    await ensureGlobalSetup(globalConfigDir, globalConfigPath, globalSkillsDir, sourceSkillsDir, homeDir);

    if (scope === 'global' || scope === 'both') {
      if (homeAgents.length > 0) {
        await installAgentSkills(globalSkillsDir, homeAgents);
      }
    }

    if (scope === 'local' || scope === 'both') {
      await ensureLocalSetup(localSuperplanDir, localConfigPath, localSkillsDir, localChangesDir, sourceSkillsDir, workspaceRoot);
      if (repoAgents.length > 0) {
        await installAgentSkills(localSkillsDir, repoAgents);
      }
    }

    const verificationIssues = await verifySetup(scope, {
      globalConfigPath,
      globalSkillsDir,
      localConfigPath,
      localSkillsDir,
      localChangesDir,
      homeAgents,
      repoAgents,
    });

    if (verificationIssues.length > 0) {
      return {
        ok: false,
        error: {
          code: 'SETUP_VERIFICATION_FAILED',
          message: verificationIssues.map(issue => issue.message).join(' '),
          retryable: false,
        },
      };
    }

    return {
      ok: true,
      data: {
        scope,
        agents: [...homeAgents, ...repoAgents],
        verified: true,
        refreshed: true,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'SETUP_FAILED',
        message: error.message || 'An unknown error occurred',
        retryable: false,
      },
    };
  }
}

export async function init(options: InitOptions = {}): Promise<InitResult> {
  try {
    if (options.scope && !isInstallScope(options.scope)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_INIT_COMMAND',
          message: getInitCommandHelpMessage(options.scope),
          retryable: false,
        },
      };
    }

    const explicitNonInteractive = Boolean(options.scope || options.yes);
    const nonInteractive = Boolean(options.quiet || explicitNonInteractive);

    if (options.json && !nonInteractive) {
      return {
        ok: false,
        error: {
          code: 'INTERACTIVE_REQUIRED',
          message: 'init must be run interactively',
          retryable: false,
        },
      };
    }

    if (!options.quiet && !options.json) {
      printSetupBanner();
    }

    const cwd = process.cwd();
    const workspaceRoot = resolveWorkspaceRoot(cwd);
    const homeDir = os.homedir();
    const sourceSkillsDir = path.resolve(__dirname, '../../skills');

    const globalConfigDir = path.join(homeDir, '.config', 'superplan');
    const globalConfigPath = path.join(globalConfigDir, 'config.toml');
    const globalSkillsDir = path.join(globalConfigDir, 'skills');

    const localSuperplanDir = path.join(workspaceRoot, '.superplan');
    const localConfigPath = path.join(localSuperplanDir, 'config.toml');
    const localSkillsDir = path.join(localSuperplanDir, 'skills');
    const localChangesDir = path.join(localSuperplanDir, 'changes');

    const alreadySetup = await pathExists(globalConfigPath) || await pathExists(localSuperplanDir);
    if (alreadySetup && !nonInteractive) {
      const reinstall = await confirm({ message: 'Superplan is already set up. Reinstall?' });
      if (!reinstall) {
        return {
          ok: true,
          data: {
            ...getScopePaths('skip', globalConfigPath, globalSkillsDir, localConfigPath, localSkillsDir),
            scope: 'skip',
            agents: [],
          },
        };
      }
    }

    const scope = options.scope
      ?? (options.quiet
        ? 'global'
        : await select<InstallScope>({
            message: 'Where do you want to install Superplan?',
            choices: [
              { name: 'Global (machine-level)', value: 'global' },
              { name: 'Local (current repository)', value: 'local' },
              { name: 'Both', value: 'both' },
              { name: 'Skip', value: 'skip' },
            ],
          }));

    if (scope === 'skip') {
      return {
        ok: true,
        data: {
          ...getScopePaths(scope, globalConfigPath, globalSkillsDir, localConfigPath, localSkillsDir),
          scope,
          agents: [],
        },
      };
    }

    const enableGlobalOverlay = nonInteractive
      ? false
      : ((scope === 'global' || scope === 'both')
        ? await confirm({ message: 'Enable desktop overlay by default on this machine?' })
        : false);
    const enableLocalOverlay = nonInteractive
      ? false
      : ((scope === 'local' || scope === 'both')
        ? await confirm({ message: 'Enable desktop overlay in this repository?' })
        : false);

    const skillsSourceError = await ensureSkillsSource(sourceSkillsDir);
    if (skillsSourceError) {
      return skillsSourceError;
    }

    const detectedRepoAgents = scope === 'local' || scope === 'both'
      ? await detectAgents(workspaceRoot, 'project')
      : [];
    const detectedHomeAgents = scope === 'global' || scope === 'both'
      ? await detectAgents(homeDir, 'global')
      : [];

    const homeAgents = scope === 'global' || scope === 'both'
      ? detectedHomeAgents.filter(a => a.detected)
      : [];

    const repoAgents = scope === 'local' || scope === 'both'
      ? (nonInteractive
        ? detectedRepoAgents
        : await promptForAgentSelection(
          scope === 'both'
            ? 'Select repository AI agents'
            : 'Select AI agents in this repository',
          detectedRepoAgents,
        ))
      : [];

    // Always ensure global config and skills exist regardless of scope,
    // since pointer-rule agents (e.g. Amazon Q) reference the global skills dir.
    await ensureGlobalSetup(globalConfigDir, globalConfigPath, globalSkillsDir, sourceSkillsDir, homeDir);

    if (scope === 'global' || scope === 'both') {
      await installOverlayCompanion(globalConfigDir);
      await writeOverlayPreference(enableGlobalOverlay, { scope: 'global', cwd });
      if (homeAgents.length > 0) {
        if (!options.quiet) {
          const names = homeAgents.map(a => getAgentDisplayName(a)).join(', ');
          console.log(`\nFound and auto-installed global AI agents: ${names}`);
        }
        await installAgentSkills(globalSkillsDir, homeAgents);
      } else if (!options.quiet && scope === 'global') {
        console.log('\nNo machine-level AI agents detected.');
      }
    }

    if (scope === 'local' || scope === 'both') {
      await ensureLocalSetup(localSuperplanDir, localConfigPath, localSkillsDir, localChangesDir, sourceSkillsDir, workspaceRoot);
      await ensureWorkspaceArtifacts(localSuperplanDir);
      await writeOverlayPreference(enableLocalOverlay, { scope: 'local', cwd: workspaceRoot });
      if (repoAgents.length > 0) {
        await installAgentSkills(localSkillsDir, repoAgents);
      }
    }

    const verificationIssues = await verifySetup(scope, {
      globalConfigPath,
      globalSkillsDir,
      localConfigPath,
      localSkillsDir,
      localChangesDir,
      homeAgents,
      repoAgents,
    });
    if (verificationIssues.length > 0) {
      return {
        ok: false,
        error: {
          code: 'INIT_VERIFICATION_FAILED',
          message: verificationIssues.map(issue => issue.message).join(' '),
          retryable: false,
        },
      };
    }

    const installedAgents = [...homeAgents, ...repoAgents];
    const bootstrapLimitedAgents = installedAgents
      .filter(agent => (agent.bootstrap_strength ?? 'skills_only') === 'skills_only')
      .map(agent => `${getAgentDisplayName(agent)} (${getBootstrapStrengthSummary(agent.bootstrap_strength ?? 'skills_only')})`);
    const noAgentsMessage = installedAgents.length === 0
      ? (options.quiet ? getNoAgentsMessage(scope, installedAgents.length) : 'No agent integrations selected.')
      : undefined;
    const quietMessage = options.quiet ? ' Quiet mode used default scope: global.' : '';
    const capabilityMessage = bootstrapLimitedAgents.length > 0
      ? ` Entry routing remains best-effort for ${bootstrapLimitedAgents.join(', ')} until a host bootstrap surface exists.`
      : '';
    const message = noAgentsMessage
      ? `${noAgentsMessage} Init verification passed.${capabilityMessage}${quietMessage}`
      : `Init verification passed.${capabilityMessage}${quietMessage}`;

    return {
      ok: true,
      data: {
        ...getScopePaths(scope, globalConfigPath, globalSkillsDir, localConfigPath, localSkillsDir),
        scope,
        agents: installedAgents,
        verified: true,
        ...(message ? { message } : {}),
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
