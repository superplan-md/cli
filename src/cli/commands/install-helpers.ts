import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { 
  AgentEnvironment, 
  AgentName, 
  AgentScope, 
  AGENT_DISPLAY_NAMES, 
  AGENT_SELECTION_ORDER,
  ALL_ENTRY_SKILL_NAMES
} from '../agent-integrations';
import { CURRENT_ENTRY_SKILL_NAME, LEGACY_SUPERPLAN_SKILL_NAMES } from '../skill-names';
import { resolveWorkspaceRoot } from '../workspace-root';

export { resolveWorkspaceRoot };

export const MANAGED_ANTIGRAVITY_BLOCK_START = '<!-- superplan-antigravity:start -->';
export const MANAGED_ANTIGRAVITY_BLOCK_END = '<!-- superplan-antigravity:end -->';
export const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START = '<!-- superplan-entry-instructions:start -->';
export const MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END = '<!-- superplan-entry-instructions:end -->';
export const MANAGED_AMAZONQ_MEMORY_BANK_START = '<!-- superplan-amazonq-memory-bank:start -->';
export const MANAGED_AMAZONQ_MEMORY_BANK_END = '<!-- superplan-amazonq-memory-bank:end -->';

export interface ExtendedAgentEnvironment extends AgentEnvironment {
  detected?: boolean;
  global_skills_dir?: string;
  source_subdirs?: string[];
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function directoryHasAtLeastOneFile(dirPath: string): Promise<boolean> {
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

export async function installSkills(sourceDir: string, targetDir: string): Promise<void> {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  const stats = await fs.stat(sourceDir);
  if (stats.isDirectory()) {
    await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
  }
}

export async function installSkillsNamespace(sourceDir: string, targetDir: string): Promise<void> {
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

export function getPointerRuleContent(globalSkillsDir: string): string {
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
- Do not edit repo files until \`superplan run --json\` or \`superplan run <task_id> --json\` returns an active task for this turn.
- Treat the returned active-task context as the edit gate. If \`run\` fails, do not proceed into implementation.
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

export function getAntigravityWorkspaceRuleContent(skillPath: string): string {
  return `# Superplan Entry Rule

Always treat this rule as active for repo work.

Before implementation, broad repo exploration, or clarifying questions for repo-work requests, load and follow:

@${skillPath}
`;
}

export function getAntigravityGlobalRuleBlock(skillPath: string): string {
  return `${MANAGED_ANTIGRAVITY_BLOCK_START}
# Superplan Entry Rule

Always treat this rule as active for repo work.

Before implementation, broad repo exploration, or clarifying questions for repo-work requests, load and follow:

@${skillPath}
${MANAGED_ANTIGRAVITY_BLOCK_END}`;
}

export function upsertManagedBlock(existingContent: string, block: string, startMarker: string, endMarker: string): string {
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

export function getManagedEntryInstructionsBlock(targetPath: string, globalSkillsDir: string): string {
  const entryPath = path.join(globalSkillsDir, 'superplan-entry', 'SKILL.md');
  const agentLinks = [
    `- \`${entryPath}\``
  ].join('\n');

  return `${MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START}
# Superplan Operating Contract

Apply this contract for any request that may touch the repo: implementation, debugging, review, planning, repo-specific clarification, or broad exploration.

Before doing any of that work, load and follow \`superplan-entry\` from the first available path:
${agentLinks}

Non-negotiable rules:
- No implementation before loading and following \`superplan-entry\`.
- No broad repo exploration before loading and following \`superplan-entry\`.
- No planning or repo-specific clarification before loading and following \`superplan-entry\`.
- Keep workflow control internal: do not narrate skill names, routing, or command logs to the user.
- If \`.superplan/\` exists, treat the Superplan CLI as the execution control plane.
- Prefer workspace harnesses, scripts, and custom workflows when \`superplan-entry\` routes you there.
- For any repo work beyond a direct answer, create a tracked Superplan task before acting — even lightweight work.
- Users cannot see what the agent is doing without a task; task creation is not ceremony, it is visibility.

Task creation rule:
- Any work that changes files, runs commands, or modifies state must be tracked as a Superplan task first.
- Do not treat "this is small" or "this is obvious" as a reason to skip task creation.
- For tiny work, one \`direct\`-depth task is enough; for multi-step work, shape a full task graph.
- Task creation happens before the first file edit, not after.
- Non-trivial edits require a concrete task contract, not just a vague intent to work on something.
- Multi-file refactors should happen only when the task graph already declares that work.

Canonical loop when Superplan is active:
1. Run \`superplan status --json\`.
2. If no active task exists for the current work, shape and scaffold one now before proceeding.
3. Claim or resume work with \`superplan run --json\` or \`superplan run <task_id> --json\`.
4. Do not edit repo files until that run command has returned an active task for this turn.
5. Continue through the owning Superplan phase instead of improvising a parallel workflow.
6. Use lifecycle commands such as \`superplan task runtime block\`, \`superplan task runtime request-feedback\`, and \`superplan task review complete\`; never hand-edit \`.superplan/runtime/\`.

Decision guardrails:
- If readiness is missing, give the concrete missing-layer guidance and stop.
- If work is already shaped, resume the owning execution or review phase instead of routing from scratch.
- If the request is large, ambiguous, or multi-workstream, route before implementing.
- If the agent is about to edit a file without a tracked task, stop and create the task first.
- If \`superplan run\`, \`status\`, or task activation returns an unexpected lifecycle or runtime error, the next action must be another Superplan command, not implementation.
- If \`superplan run\` fails, do not proceed until the task is blocked, reopened, repaired, or clarified through Superplan.
${MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END}`;
}

export function getAmazonQMemoryBankBlock(entrySkillContent: string): string {
  return `${MANAGED_AMAZONQ_MEMORY_BANK_START}
# Superplan Operating Contract

Always always pay attention to the Superplan rules in \`.amazonq/rules/\` before doing anything else for repo work.

Non-negotiable requirements:
- No development is allowed before loading and following \`superplan-entry\`.
- No broad repo exploration is allowed before loading and following \`superplan-entry\`.
- No planning, clarification, or task breakdown is allowed before loading and following \`superplan-entry\`.
- If any Superplan rule applies, follow the owning rule instead of improvising.
- For packed, ambiguous, or multi-constraint requests, route through Superplan first and do not begin implementation directly.
- For any repo work that changes files or state, create a tracked Superplan task before acting — even small work.
- Task creation is user visibility, not ceremony; users cannot see what the agent is doing without it.
- Do not edit repo files until \`superplan run --json\` or \`superplan run <task_id> --json\` returns an active task for this turn.
- If \`run\` or a lifecycle command fails unexpectedly, the next move must stay inside Superplan until runtime state is repaired or clarified.

Embedded \`superplan-entry\` rule for reinforcement:

\`\`\`md
${entrySkillContent.trim()}
\`\`\`
${MANAGED_AMAZONQ_MEMORY_BANK_END}`;
}

export async function installManagedInstructionsFile(targetPath: string, globalSkillsDir: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const existingContent = await fs.readFile(targetPath, 'utf-8').catch(() => '');
  const nextContent = upsertManagedBlock(
    existingContent,
    getManagedEntryInstructionsBlock(targetPath, globalSkillsDir),
    MANAGED_ENTRY_INSTRUCTIONS_BLOCK_START,
    MANAGED_ENTRY_INSTRUCTIONS_BLOCK_END,
  );
  await fs.writeFile(targetPath, nextContent, 'utf-8');
}

export async function installAntigravityWorkspaceRule(targetPath: string, skillPath: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, getAntigravityWorkspaceRuleContent(skillPath), 'utf-8');
}

export async function installAntigravityGlobalRule(targetPath: string, skillPath: string): Promise<void> {
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

export async function installAntigravityWorkflows(skillsDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!await pathExists(skillPath)) {
      continue;
    }

    const skillContent = await fs.readFile(skillPath, 'utf-8');
    const targetPath = path.join(targetDir, `${entry.name}.md`);

    // Ensure Antigravity workflows have required frontmatter
    if (!skillContent.startsWith('---')) {
      const frontmatter = `---\nname: ${entry.name}\ndescription: Superplan ${entry.name} workflow\n---\n\n`;
      await fs.writeFile(targetPath, frontmatter + skillContent, 'utf-8');
    } else {
      await fs.writeFile(targetPath, skillContent, 'utf-8');
    }
  }
}

export async function installAmazonQRules(skillsDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });

  for (const cleanupPath of [
    path.join(targetDir, 'superplan.md'),
    path.join(targetDir, 'superplan'),
    path.join(targetDir, 'superplan-entry'),
  ]) {
    await fs.rm(cleanupPath, { recursive: true, force: true });
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!await pathExists(skillPath)) {
      continue;
    }

    const skillContent = await fs.readFile(skillPath, 'utf-8');
    await fs.writeFile(path.join(targetDir, `${entry.name}.md`), skillContent, 'utf-8');
  }
}

export async function installAmazonQMemoryBank(skillsDir: string, rulesDir: string): Promise<void> {
  const memoryBankDir = path.join(rulesDir, 'memory-bank');
  await fs.mkdir(memoryBankDir, { recursive: true });
  const entrySkillPath = path.join(skillsDir, CURRENT_ENTRY_SKILL_NAME, 'SKILL.md');
  const entrySkillContent = await fs.readFile(entrySkillPath, 'utf-8');
  const managedBlock = getAmazonQMemoryBankBlock(entrySkillContent);

  for (const fileName of ['product.md', 'guidelines.md', 'tech.md']) {
    const targetPath = path.join(memoryBankDir, fileName);
    const existingContent = await fs.readFile(targetPath, 'utf-8').catch(() => '');
    const nextContent = upsertManagedBlock(
      existingContent,
      managedBlock,
      MANAGED_AMAZONQ_MEMORY_BANK_START,
      MANAGED_AMAZONQ_MEMORY_BANK_END,
    );
    await fs.writeFile(targetPath, nextContent, 'utf-8');
  }
}

export async function installAgentSkills(skillsDir: string, agents: ExtendedAgentEnvironment[]): Promise<void> {
  // We need to copy templates from the CLI's installation package output/ dir, not the user's config dir.
  const sourceOutputDir = path.resolve(__dirname, '../../../output');  for (const agent of agents) {
    await copyAgentBaseFiles(sourceOutputDir, agent);
    const globalSkillsDir = agent.global_skills_dir ?? path.join(os.homedir(), '.config', 'superplan', 'skills');

    if (agent.install_kind && agent.install_path) {
      if (agent.install_kind === 'skills_namespace') {
        // SSoT: We stop physical mirroring into agent.install_path
        // and instead verify the agent directory exists.
        await fs.mkdir(path.dirname(agent.install_path), { recursive: true });
      } else if (agent.install_kind === 'toml_command') {
        await fs.mkdir(path.dirname(agent.install_path), { recursive: true });
        await fs.writeFile(agent.install_path, getGeminiCommandContent(), 'utf-8');
      } else if (agent.install_kind === 'pointer_rule') {
        await fs.mkdir(path.dirname(agent.install_path), { recursive: true });
        await fs.writeFile(agent.install_path, getPointerRuleContent(globalSkillsDir), 'utf-8');
      } else if (agent.install_kind === 'managed_global_rule') {
        await installManagedInstructionsFile(agent.install_path, globalSkillsDir);
      } else if (agent.install_kind === 'amazonq_rules') {
        await installAmazonQRules(globalSkillsDir, agent.install_path);
        await installAmazonQMemoryBank(globalSkillsDir, agent.install_path);
      } else if (agent.install_kind === 'antigravity_workflows') {
        await installAntigravityWorkflows(globalSkillsDir, agent.install_path);
      }
    } else if (!agent.install_kind && agent.name === 'gemini') {
      // Legacy fallback for Gemini if needed, but project-level Gemini has install_kind
    }

    // Agent-specific cleanup of legacy files if defined
    for (const cleanupPath of agent.cleanup_paths ?? []) {
      if (await pathExists(cleanupPath)) {
        await fs.rm(cleanupPath, { recursive: true, force: true });
      }
    }
  }
}

async function copyAgentBaseFiles(outputDir: string, agent: ExtendedAgentEnvironment): Promise<void> {
  if (!agent.source_subdirs) return;

  for (const subdir of agent.source_subdirs) {
    const sourceDir = path.join(outputDir, subdir);
    if (!await pathExists(sourceDir)) continue;

    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip the 'skills' or 'workflows' directories as they are handled separately
      if (entry.name === 'skills' || entry.name === 'workflows') continue;

      const src = path.join(sourceDir, entry.name);
      const dest = path.join(agent.path, entry.name);

      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (entry.isDirectory()) {
        await fs.cp(src, dest, { recursive: true });
      } else {
        await fs.copyFile(src, dest);
      }
    }
  }
}

export function getAgentDefinitions(baseDir: string, scope: AgentScope): ExtendedAgentEnvironment[] {
  if (scope === 'project') {
    return [
      {
        name: 'claude',
        path: path.join(baseDir, '.claude'),
        source_subdirs: ['claude', 'claude-plugin', 'hooks'],
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.claude', 'commands', 'superplan.md'),
          path.join(baseDir, '.claude', 'skills')
        ],
      },
      {
        name: 'gemini',
        path: path.join(baseDir, '.gemini'),
        source_subdirs: ['gemini'],
        install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
        install_kind: 'toml_command',
        bootstrap_strength: 'context_bootstrap',
      },
      {
        name: 'cursor',
        path: path.join(baseDir, '.cursor'),
        source_subdirs: ['cursor', 'cursor-plugin', 'hooks'],
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.cursor', 'commands', 'superplan.md'),
          path.join(baseDir, '.cursor', 'skills')
        ],
      },
      {
        name: 'codex',
        path: path.join(baseDir, '.codex'),
        source_subdirs: ['codex', 'codex-plugin', 'hooks'],
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.codex', 'skills'),
          path.join(baseDir, '.codex', 'skills', 'superplan')
        ],
      },
      {
        name: 'opencode',
        path: path.join(baseDir, '.opencode'),
        source_subdirs: ['opencode', 'opencode-plugin', 'hooks'],
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.opencode', 'commands', 'superplan.md'),
          path.join(baseDir, '.opencode', 'skills')
        ],
      },
      {
        name: 'amazonq',
        path: path.join(baseDir, '.amazonq'),
        install_path: path.join(baseDir, '.amazonq', 'rules'),
        install_kind: 'amazonq_rules',
        bootstrap_strength: 'rule_bootstrap',
        cleanup_paths: [
          path.join(baseDir, '.amazonq', 'rules', 'superplan'),
          path.join(baseDir, '.amazonq', 'rules', 'superplan-entry'),
          path.join(baseDir, '.amazonq', 'rules', 'superplan.md'),
        ],
      },
      {
        name: 'antigravity',
        path: path.join(baseDir, '.agents'),
        source_subdirs: ['agents'],
        install_path: path.join(baseDir, '.agents', 'workflows'),
        install_kind: 'antigravity_workflows',
        bootstrap_strength: 'rule_bootstrap',
        cleanup_paths: [path.join(baseDir, '.agents', 'rules', 'superplan-entry.md')],
      },
      {
        name: 'copilot',
        path: path.join(baseDir, '.github'),
        install_path: path.join(baseDir, '.github', 'copilot-instructions.md'),
        install_kind: 'pointer_rule',
        bootstrap_strength: 'rule_bootstrap',
      },
    ];
  }

  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      source_subdirs: ['claude', 'claude-plugin', 'hooks'],
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.claude', 'commands', 'superplan.md'),
        path.join(baseDir, '.claude', 'skills')
      ],
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      source_subdirs: ['gemini'],
      install_path: path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
      install_kind: 'toml_command',
      bootstrap_strength: 'context_bootstrap',
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      source_subdirs: ['cursor', 'cursor-plugin', 'hooks'],
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.cursor', 'commands', 'superplan.md'),
        path.join(baseDir, '.cursor', 'skills')
      ],
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      source_subdirs: ['codex', 'codex-plugin', 'hooks'],
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.codex', 'skills'),
        path.join(baseDir, '.codex', 'skills', 'superplan')
      ],
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.config', 'opencode'),
      source_subdirs: ['opencode', 'opencode-plugin', 'hooks'],
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.config', 'opencode', 'commands', 'superplan.md'),
        path.join(baseDir, '.config', 'opencode', 'skills')
      ],
    },

    {
      name: 'antigravity',
      path: path.join(baseDir, '.gemini'),
      source_subdirs: ['gemini'],
      install_path: path.join(baseDir, '.gemini', 'GEMINI.md'),
      install_kind: 'managed_global_rule',
      bootstrap_strength: 'rule_bootstrap',
    },
    {
      name: 'copilot',
      path: path.join(baseDir, '.github'),
      install_path: path.join(baseDir, '.github', 'copilot-instructions.md'),
      install_kind: 'pointer_rule',
      bootstrap_strength: 'rule_bootstrap',
    },
  ];
}

export async function detectVSCodeExtensions(): Promise<Set<string>> {
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
      if (name.startsWith('github.copilot')) detected.add('copilot');
    }
  } catch {
    // Ignore errors if directory doesn't exist
  }

  return detected;
}

export async function detectAgents(baseDir: string, scope: AgentScope): Promise<ExtendedAgentEnvironment[]> {
  const definitions = getAgentDefinitions(baseDir, scope);
  const extensions = await detectVSCodeExtensions();
  
  for (const agent of definitions) {
    const hasConfigDir = await pathExists(agent.path);
    const hasExtension = extensions.has(agent.name);
    agent.detected = hasConfigDir || hasExtension;
  }
  
  return definitions;
}

export function getAgentDisplayName(agent: ExtendedAgentEnvironment): string {
  return AGENT_DISPLAY_NAMES[agent.name] ?? agent.name;
}

export function sortAgentsForSelection(agents: ExtendedAgentEnvironment[]): ExtendedAgentEnvironment[] {
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

function getGeminiCommandContent(): string {
  return `description = "Use Superplan as the task execution control plane for this repository"

prompt = """
Use the Superplan CLI in this repository as the source of truth for task state.

Common commands:
- \`superplan context bootstrap --json\`
- \`superplan context status --json\`
- \`superplan change new <change-slug> --json\`
- \`superplan validate <change-slug> --json\`
- \`superplan task scaffold new <change-slug> --task-id <task_id> --json\`
- \`superplan task scaffold batch <change-slug> --stdin --json\`
- \`superplan status --json\`
- \`superplan run --json\`
- \`superplan run <task_id> --json\`
- \`superplan task inspect show <task_id> --json\`
- \`superplan task runtime block <task_id> --reason "<reason>" --json\`
- \`superplan task runtime request-feedback <task_id> --message "<message>" --json\`
- \`superplan task review complete <task_id> --json\`
- \`superplan task repair fix --json\`
- \`superplan doctor --json\`
- \`superplan overlay ensure --json\`
- \`superplan overlay hide --json\`

Execution loop:
1. Check \`superplan status --json\`
2. Claim work with \`superplan run --json\`
3. Do not edit repo files until \`superplan run --json\` or \`superplan run <task_id> --json\` has returned an active task context for this turn; use that payload as the edit gate
4. If \`run\`, \`status\`, or task activation returns an unexpected lifecycle or runtime error, stay inside Superplan and repair, block, reopen, or inspect before attempting implementation
5. Update runtime state with block, feedback, complete, or fix commands instead of editing markdown state by hand
6. After implementation proof passes, do not end the turn with the task still effectively pending or in progress; move it through \`superplan task review complete <task_id> --json\` and the appropriate review path, or state the exact blocker
7. Use \`superplan context bootstrap --json\` when durable workspace context entrypoints are missing, then keep \`.superplan\/context\/\`, \`.superplan\/decisions.md\`, \`.superplan\/gotchas.md\`, and \`.superplan\/plan.md\` honest instead of inventing ad hoc files
8. When shaping tracked work, author the graph in \`.superplan\/changes\/<change-slug>\/tasks.md\` first, run \`superplan validate <change-slug> --json\`, then scaffold contracts by graph-declared task id instead of hand-creating \`tasks\/T-xxx.md\`
9. When the request is large, ambiguous, or multi-workstream, do not jump straight from the raw request into task scaffolding; clarify expectations, capture spec or plan truth when needed, then finalize the graph
10. If overlay support is enabled for this workspace and a launchable companion is installed, \`superplan task scaffold new\`, \`superplan task scaffold batch\`, \`superplan run\`, \`superplan run <task_id>\`, and \`superplan task review reopen\` can auto-reveal the overlay when work becomes visible; on a fresh machine or after install/update, verify overlay health with \`superplan doctor --json\` and \`superplan overlay ensure --json\` before assuming it is working, and inspect launchability or companion errors if the reveal fails; use \`superplan overlay hide --json\` when it becomes idle or empty
11. After overlay-triggering commands, inspect the returned \`overlay\` payload; if \`overlay.companion.launched\` is false, surface \`overlay.companion.reason\` instead of assuming the overlay appeared

Authoring rule:
- Use \`superplan context bootstrap --json\` to create missing workspace context entrypoints instead of hand-writing them from scratch
- Use \`superplan change new <change-slug> --json\` once per tracked change
- Let \`superplan change new\` scaffold the tracked change root, including spec surfaces, before filling in graph truth
- Author the root \`.superplan\/changes\/<change-slug>\/tasks.md\` manually as graph truth; the shell-loop prohibition applies to task-contract generation and bulk graph rewrites, not to normal manual graph authoring
- Never create or edit \`.superplan\/changes\/<change-slug>\/tasks\/T-xxx.md\` task contracts with shell loops or direct file-edit rewrites such as \`for\`, \`sed\`, \`cat > ...\`, \`printf > ...\`, here-docs, or ad hoc batch rewrites; shell is only acceptable here as stdin transport into \`superplan task scaffold batch --stdin --json\`
- When the request is large, ambiguous, or multi-workstream, do not jump straight from the raw request into task scaffolding; capture clarification, spec, or plan truth first, then finalize the graph
- Author \`.superplan\/changes\/<change-slug>\/tasks.md\` manually as graph truth, then run \`superplan validate <change-slug> --json\` before scaffolding task contracts
- Use \`superplan task scaffold new <change-slug> --task-id <task_id> --json\` only when exactly one graph-declared task contract should be created now
- Use \`superplan task scaffold batch --stdin --json\` when two or more graph-declared task contracts are ready to be scaffolded in one pass
- Prefer stdin over temp files in agent flows
- Use the returned task payloads directly after authoring instead of immediately calling \`superplan task inspect show\`

Canonical selection rule:
- Prefer the one canonical command for the intent instead of choosing among overlapping alternatives
- Prefer commands that already return the needed task payload instead of making extra follow-up calls

User communication rule:
- Keep workflow control and command-by-command orchestration internal unless the user explicitly asks for it
- Do not narrate meta progress such as which Superplan skill is active, that routing or shaping is happening, or lists of explored files and commands
- Progress updates should focus on user value: what is changing, what risk is being checked, what decision matters, or what blocker needs attention
- Prefer project thoughts over process thoughts

Never write \`.superplan\/runtime\/overlay.json\` by hand.
"""`;
}

export type RefreshInstalledSkillsResult =
  | {
      ok: true;
      data: {
        refreshed: boolean;
        scope: 'skip' | 'global' | 'local' | 'both';
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

export async function refreshInstalledSkills(): Promise<RefreshInstalledSkillsResult> {
  try {
    const homeDir = os.homedir();
    const globalConfigDir = path.join(homeDir, '.config', 'superplan');
    const sourceSkillsDir = path.resolve(__dirname, '../../../output/skills');

    if (!await pathExists(globalConfigDir)) {
      return { ok: true, data: { refreshed: false, scope: 'skip' } };
    }

    // Refresh global skills
    const globalSkillsDir = path.join(globalConfigDir, 'skills');
    await installSkills(sourceSkillsDir, globalSkillsDir);

    // Refresh global agents
    const globalAgents = await detectAgents(homeDir, 'global');
    await installAgentSkills(globalSkillsDir, globalAgents);

    let scope: 'skip' | 'global' | 'local' | 'both' = 'global';

    // Refresh local skills if in a project
    const cwd = process.cwd();
    const superplanRoot = path.join(cwd, '.superplan');
    if (await pathExists(superplanRoot)) {
      const localSkillsDir = path.join(superplanRoot, 'skills');
      await installSkills(sourceSkillsDir, localSkillsDir);
      
      const projectAgents = await detectAgents(cwd, 'project');
      await installAgentSkills(localSkillsDir, projectAgents);
      scope = 'both';
    }

    return {
      ok: true,
      data: {
        refreshed: true,
        scope,
      },
    };
  } catch (error: any) {
    return {
      ok: false,
      error: {
        code: 'REFRESH_SKILLS_FAILED',
        message: error.message || 'Failed to refresh skills',
        retryable: true,
      },
    };
  }
}
