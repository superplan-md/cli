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

Before making ANY code changes or entering tracked execution:
- Load \`superplan-entry\` first and let it decide whether Superplan should engage.
- Read-only repo inspection and approach reasoning are allowed before task creation.
- If Superplan instructions are installed for this workspace, you ARE in a structured workflow. Tracked changes and runtime may live under a shared project state root such as \`~/.config/superplan/project-<name>-<hash>/\`, and the CLI may surface those paths as \`.superplan/...\` from the repo root.
- Do not edit repo files or mutate repo state until \`superplan run --json\` or \`superplan run <task_ref> --json\` returns an active task for this turn.
- Treat the returned active-task context as the edit gate. If \`run\` fails, do not proceed into implementation.
- Use \`superplan status --json\` only when you need orientation, inspection, or recovery.
- Use the CLI for all lifecycle transitions (block, feedback, complete).
- Never hand-edit shared runtime files under \`~/.config/superplan/project-<name>-<hash>/runtime/\`.

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
  const entryCandidates = new Set<string>();
  const targetDir = path.dirname(targetPath);

  if (path.basename(targetPath) === 'CLAUDE.md') {
    const localClaudeDir = path.basename(targetDir) === '.claude'
      ? targetDir
      : path.join(targetDir, '.claude');
    entryCandidates.add(path.join(localClaudeDir, 'skills', 'superplan-entry', 'SKILL.md'));
    entryCandidates.add(path.join(os.homedir(), '.claude', 'skills', 'superplan-entry', 'SKILL.md'));
  } else {
    entryCandidates.add(entryPath);
  }

  const agentLinks = [...entryCandidates]
    .map(candidate => `- \`${candidate}\``)
    .join('\n');

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
- Treat the Superplan CLI as the execution control plane for structured repo work, even when tracked changes and runtime live under a shared project state root such as \`~/.config/superplan/project-<name>-<hash>/\` and are surfaced as \`.superplan/...\` from the repo root.
- Prefer workspace harnesses, scripts, and custom workflows when \`superplan-entry\` routes you there.
- For repo work that will enter execution, create or claim a tracked Superplan task before editing files or mutating repo state — even lightweight work.
- Users cannot see active execution without a task; task creation is not ceremony, it is visibility.

Task creation rule:
- Read-only repo inspection, local reasoning, and user-facing planning may happen before task creation.
- Any work that edits files, mutates repo state, or enters tracked execution must be attached to a Superplan task first.
- Do not treat "this is small" or "this is obvious" as a reason to skip task creation once execution is about to begin.
- For tiny work, one \`direct\`-depth task is enough; for multi-step work, shape a full task graph.
- Task creation happens before the first file edit or stateful repo mutation, not after.
- Non-trivial edits require a concrete task contract, not just a vague intent to work on something.
- Multi-file refactors should happen only when the task graph already declares that work.

Session focus rule:
- Session-local routing depends on a stable per-chat \`SUPERPLAN_SESSION_ID\`.
- If the host or startup hook already exported \`SUPERPLAN_SESSION_ID\`, preserve it on every \`superplan\` command in this chat.
- If startup context gives you a Superplan session token but the host did not auto-export it, prefix every Superplan CLI command with \`SUPERPLAN_SESSION_ID=<token>\`.
- If the host has no startup hook or session export path, mint one stable chat-local token before the first Superplan CLI command and reuse it for the rest of the chat.
- Use \`superplan run --fresh --json\` when the user starts unrelated work in the same chat and you need to bypass the saved session focus without explicitly resuming old work.

Communication modes:
- \`control-plane mode\` is the default for \`superplan-entry\`, \`superplan-route\`, \`superplan-shape\`, \`superplan-execute\`, and normal lifecycle handling. Be terse, outcome-focused, and mostly silent about workflow mechanics. No phase narration.
- \`planning mode\` is for \`superplan-plan\`, \`superplan-brainstorm\`, or any point where the user needs help choosing an approach. Be detailed about approaches, recommendation, trade-offs, and execution path while keeping Superplan ceremony in the background.
- Do not blend the modes accidentally: control-plane work should stay quiet, and planning work should make the useful reasoning visible.

Canonical loop when Superplan is active:
1. If continuing known work, run \`superplan run <task_ref> --json\`; if the user starts unrelated work in this same chat, run \`superplan run --fresh --json\`; otherwise start with \`superplan run --json\`.
2. Treat the returned active-task context as the edit gate. Do not edit repo files until a run command has returned an active task for this turn.
3. If \`run\` did not return an active task for the current work, shape and scaffold the minimal honest task now, then claim it.
4. Use \`superplan status --json\` only when you need frontier orientation, human inspection, or recovery after ambiguity.
5. Continue through the owning Superplan phase instead of improvising a parallel workflow.
6. Use lifecycle commands such as \`superplan task runtime block\`, \`superplan task runtime request-feedback\`, and \`superplan task review complete\`, and use \`superplan worktree ensure <change> --json\` / \`superplan worktree list --json\` when execution-root routing needs repair; never hand-edit shared runtime files under \`~/.config/superplan/project-<name>-<hash>/runtime/\`.

Decision guardrails:
- If readiness is missing, give the concrete missing-layer guidance and stop.
- If work is already shaped, resume the owning execution or review phase instead of routing from scratch.
- If the request is large, ambiguous, or multi-workstream, route before implementing.
- If the agent is about to edit a file or mutate repo state without a tracked task, stop and create or claim the task first.
- If \`superplan run\`, \`status\`, or task activation returns an unexpected lifecycle or runtime error, the next action must be another Superplan command, not implementation.
- If \`superplan run\` or task activation returns \`EXECUTION_ROOT_OCCUPIED\` or \`EXECUTION_ROOT_STALE\`, inspect or repair execution roots with \`superplan worktree list --json\` or \`superplan worktree ensure <change> --json\` before editing in the wrong checkout.
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
- Read-only repo inspection, local reasoning, and user-facing planning may happen before task creation.
- For repo work that will edit files, mutate repo state, or enter tracked execution, create or claim a tracked Superplan task before acting — even small work.
- Task creation is user visibility, not ceremony; users cannot see active execution without it.
- Do not edit repo files or mutate repo state until \`superplan run --json\`, \`superplan run --fresh --json\`, or \`superplan run <task_ref> --json\` returns an active task for this turn.
- Use \`control-plane mode\` for normal workflow control and \`planning mode\` only when the user actually needs approaches, recommendation, trade-offs, and execution path detail.
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

export async function installWindsurfRules(skillsDir: string, targetDir: string): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(skillsDir, { withFileTypes: true });

  // Clean up old paths
  for (const cleanupPath of [
    path.join(targetDir, '..', 'skills'),
    path.join(targetDir, '..', '.windsurfrules'),
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

export async function installWindsurfEnforcementFiles(agentPath: string, globalSkillsDir: string): Promise<void> {
  const claudeMdPath = path.join(agentPath, 'CLAUDE.md');
  const workflowsDir = path.join(agentPath, 'workflows');
  const gatePath = path.join(workflowsDir, 'superplan-gate.md');

  const claudeMdContent = `# Superplan Hard Constraints

## CRITICAL RULES - NO EXCEPTIONS

- **I CANNOT edit files or mutate repo state without first claiming or creating the correct Superplan task**
- **I CANNOT proceed without an active Superplan task**
- **I CAN inspect and understand the repo before task creation, but I MUST stay read-only until a task is active**
- **I MUST use control-plane mode for normal workflow control: terse, outcome-focused, no phase narration**
- **I MUST switch to planning mode only when the user needs detailed approaches, recommendation, trade-offs, or execution path**
- **Single-file edits are the ONLY exception**
- **If I violate this, I MUST stop and restart correctly**

## Mandatory Workflow

Before repo execution:
1. Load \`superplan-entry\`
2. If continuing known work, run \`superplan run <task_ref> --json\`; if the user starts unrelated work in this same chat, run \`superplan run --fresh --json\`; otherwise run \`superplan run --json\`
3. If no active task exists for the current work, STOP and shape/scaffold the minimal honest task, then claim it
4. Only proceed after the task is active

## Task Creation Rule

Read-only repo inspection and planning may happen before task creation. Any work that changes files, mutates repo state, or enters tracked execution must be tracked as a Superplan task first — even small work.

## Entry Point

Load and follow \`superplan-entry\` from:
- \`${path.join(globalSkillsDir, 'superplan-entry', 'SKILL.md')}\`

## Global Skills

\`${globalSkillsDir}\`
`;

  const gateContent = `---
description: Mandatory gate before any repo work
---

# Superplan Pre-Flight Check

1. Load \`superplan-entry\`
2. If continuing known work, run \`superplan run <task_ref> --json\`; if the user starts unrelated work in this same chat, run \`superplan run --fresh --json\`; otherwise run \`superplan run --json\`
3. If no active task matches the current work, STOP and shape/scaffold it before edits
4. Use \`superplan status --json\` only when orientation or recovery is needed
5. Violations require immediate workflow restart
`;

  await fs.writeFile(claudeMdPath, claudeMdContent, 'utf-8');
  await fs.mkdir(workflowsDir, { recursive: true });
  await fs.writeFile(gatePath, gateContent, 'utf-8');
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

const CLAUDE_SESSION_START_HOOK = {
  matcher: 'startup|clear|compact',
  hooks: [
    {
      type: 'command',
      command: './run-hook.cmd session-start',
      async: false,
    },
  ],
};

async function installClaudeSettingsHooks(settingsPath: string): Promise<void> {
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });

  let existing: Record<string, any> = {};
  try {
    existing = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  const hooks = typeof existing.hooks === 'object' && existing.hooks !== null
    ? { ...existing.hooks }
    : {};

  delete hooks.sessionStart;
  hooks.SessionStart = [CLAUDE_SESSION_START_HOOK];

  const nextSettings = {
    ...existing,
    hooks,
  };

  await fs.writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf-8');
}

export async function installAgentSkills(skillsDir: string, agents: ExtendedAgentEnvironment[]): Promise<void> {
  // We need to copy templates from the CLI's installation package output/ dir, not the user's config dir.
  const sourceOutputDir = path.resolve(__dirname, '../../../output');
  for (const agent of agents) {
    // Ensure agent directory exists
    await fs.mkdir(agent.path, { recursive: true });
    
    await copyAgentBaseFiles(sourceOutputDir, agent);
    const globalSkillsDir = agent.global_skills_dir ?? path.join(os.homedir(), '.config', 'superplan', 'skills');

    if (agent.install_kind && agent.install_path) {
      if (agent.install_kind === 'skills_namespace') {
        await installSkillsNamespace(globalSkillsDir, agent.install_path);
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
      } else if (agent.install_kind === 'windsurf_rules') {
        await installWindsurfRules(globalSkillsDir, agent.install_path);
        await installWindsurfEnforcementFiles(agent.path, globalSkillsDir);
      } else if (agent.install_kind === 'antigravity_workflows') {
        await installAntigravityWorkflows(globalSkillsDir, agent.install_path);
      }
    } else if (!agent.install_kind && agent.name === 'gemini') {
      // Legacy fallback for Gemini if needed, but project-level Gemini has install_kind
    }

    if (agent.name === 'claude' && agent.settings_path) {
      await installClaudeSettingsHooks(agent.settings_path);
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
        install_path: path.join(baseDir, '.claude', 'skills'),
        settings_path: path.join(baseDir, '.claude', 'settings.local.json'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.claude', 'commands', 'superplan.md'),
          path.join(baseDir, '.claude', 'hooks.json'),
          path.join(baseDir, '.claude', 'hooks-cursor.json'),
          path.join(baseDir, '.claude', 'plugin.json'),
        ],
      },
      {
        name: 'gemini',
        path: path.join(baseDir, '.gemini'),
        source_subdirs: ['gemini'],
        install_path: path.join(baseDir, '.gemini', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'context_bootstrap',
        cleanup_paths: [
          path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
        ],
      },
      {
        name: 'cursor',
        path: path.join(baseDir, '.cursor'),
        source_subdirs: ['cursor', 'cursor-plugin', 'hooks'],
        install_path: path.join(baseDir, '.cursor', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.cursor', 'commands', 'superplan.md'),
          // Note: .cursor/skills/ is the install_path, don't clean it up
        ],
      },
      {
        name: 'codex',
        path: path.join(baseDir, '.codex'),
        source_subdirs: ['codex', 'codex-plugin', 'hooks'],
        install_path: path.join(baseDir, '.codex', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.codex', 'skills', 'superplan'),
          // Note: .codex/skills/ is the install_path, don't clean it up
        ],
      },
      {
        name: 'opencode',
        path: path.join(baseDir, '.opencode'),
        source_subdirs: ['opencode', 'opencode-plugin', 'hooks'],
        install_path: path.join(baseDir, '.opencode', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'skills_only',
        cleanup_paths: [
          path.join(baseDir, '.opencode', 'commands', 'superplan.md'),
          // Note: .opencode/skills/ is the install_path, don't clean it up
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
        install_path: path.join(baseDir, '.github', 'skills'),
        install_kind: 'skills_namespace',
        bootstrap_strength: 'rule_bootstrap',
        cleanup_paths: [
          path.join(baseDir, '.github', 'copilot-instructions.md'),
        ],
      },
      {
        name: 'windsurf',
        path: path.join(baseDir, '.windsurf'),
        install_path: path.join(baseDir, '.windsurf', 'workflows'),
        install_kind: 'windsurf_rules',
        bootstrap_strength: 'rule_bootstrap',
        cleanup_paths: [
          path.join(baseDir, '.windsurf', 'skills'),
          path.join(baseDir, '.windsurf', 'rules'),
          path.join(baseDir, '.windsurfrules'),
        ],
      },
    ];
  }

  return [
    {
      name: 'claude',
      path: path.join(baseDir, '.claude'),
      source_subdirs: ['claude', 'claude-plugin', 'hooks'],
      install_path: path.join(baseDir, '.claude', 'skills'),
      settings_path: path.join(baseDir, '.claude', 'settings.json'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.claude', 'commands', 'superplan.md'),
        path.join(baseDir, '.claude', 'hooks.json'),
        path.join(baseDir, '.claude', 'hooks-cursor.json'),
        path.join(baseDir, '.claude', 'plugin.json'),
      ],
    },
    {
      name: 'gemini',
      path: path.join(baseDir, '.gemini'),
      source_subdirs: ['gemini'],
      install_path: path.join(baseDir, '.gemini', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'context_bootstrap',
      cleanup_paths: [
        path.join(baseDir, '.gemini', 'commands', 'superplan.toml'),
      ],
    },
    {
      name: 'cursor',
      path: path.join(baseDir, '.cursor'),
      source_subdirs: ['cursor', 'cursor-plugin', 'hooks'],
      install_path: path.join(baseDir, '.cursor', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.cursor', 'commands', 'superplan.md'),
        // Note: .cursor/skills/ is the install_path, don't clean it up
      ],
    },
    {
      name: 'codex',
      path: path.join(baseDir, '.codex'),
      source_subdirs: ['codex', 'codex-plugin', 'hooks'],
      install_path: path.join(baseDir, '.codex', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.codex', 'skills', 'superplan')
        // Note: .codex/skills/ is the install_path, don't clean it up
      ],
    },
    {
      name: 'opencode',
      path: path.join(baseDir, '.config', 'opencode'),
      source_subdirs: ['opencode', 'opencode-plugin', 'hooks'],
      install_path: path.join(baseDir, '.config', 'opencode', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'skills_only',
      cleanup_paths: [
        path.join(baseDir, '.config', 'opencode', 'commands', 'superplan.md'),
        // Note: .config/opencode/skills/ is the install_path, don't clean it up
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
      install_path: path.join(baseDir, '.github', 'skills'),
      install_kind: 'skills_namespace',
      bootstrap_strength: 'rule_bootstrap',
      cleanup_paths: [
        path.join(baseDir, '.github', 'copilot-instructions.md'),
      ],
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
      if (name.startsWith('codeium.windsurf')) detected.add('windsurf');
    }
  } catch {
    // Ignore errors if directory doesn't exist
  }

  return detected;
}

async function hasClaudePreferenceMarker(baseDir: string, scope: AgentScope): Promise<boolean> {
  const candidatePaths = scope === 'global'
    ? [
        path.join(baseDir, 'CLAUDE.md'),
        path.join(baseDir, '.claude'),
      ]
    : [
        path.join(baseDir, 'CLAUDE.md'),
        path.join(baseDir, '.claude'),
      ];

  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return true;
    }
  }

  return false;
}

export async function detectAgents(baseDir: string, scope: AgentScope): Promise<ExtendedAgentEnvironment[]> {
  const definitions = getAgentDefinitions(baseDir, scope);
  const extensions = await detectVSCodeExtensions();
  
  for (const agent of definitions) {
    const hasConfigDir = await pathExists(agent.path);
    const hasExtension = extensions.has(agent.name);
    const hasPreferenceMarker = agent.name === 'claude'
      ? await hasClaudePreferenceMarker(baseDir, scope)
      : false;
    agent.detected = hasConfigDir || hasExtension || hasPreferenceMarker;
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
- \`superplan change plan set <change-slug> --stdin --json\`
- \`superplan change spec set <change-slug> --name <spec-slug> --stdin --json\`
- \`superplan change task add <change-slug> --title "..." --json\`
- \`superplan context doc set <doc-slug> --stdin --json\`
- \`superplan context log add --kind <decision|gotcha> --content "..." --json\`
- \`superplan validate <change-slug> --json\`
- \`superplan task scaffold new <change-slug> --task-id <task_id> --json\`
- \`superplan task scaffold batch <change-slug> --stdin --json\`
- \`superplan status --json\`
- \`superplan run --json\`
- \`superplan run --fresh --json\`
- \`superplan run <task_ref> --json\`
- \`superplan task inspect show <task_ref> --json\`
- \`superplan task runtime block <task_ref> --reason "<reason>" --json\`
- \`superplan task runtime request-feedback <task_ref> --message "<message>" --json\`
- \`superplan task review complete <task_ref> --json\`
- \`superplan task repair fix --json\`
- \`superplan doctor --json\`
- \`superplan worktree ensure <change-slug> --json\`
- \`superplan worktree list --json\`
- \`superplan worktree detach <change-slug> --json\`
- \`superplan worktree prune --json\`
- \`superplan overlay ensure --json\`
- \`superplan overlay hide --json\`

Execution loop:
1. If continuing known work, run \`superplan run <task_ref> --json\`; if the user starts unrelated work in this same chat, run \`superplan run --fresh --json\`; otherwise start with \`superplan run --json\`
2. Read-only repo inspection, local reasoning, and user-facing planning may happen before task creation; do not edit repo files or mutate repo state until a run command has returned an active task context for this turn
3. Treat the returned active-task payload as the edit gate; if \`run\` returned no active task for the current work, shape/scaffold the minimal honest task, then claim it
4. Use \`superplan status --json\` only when frontier orientation, inspection, or recovery is actually needed
5. If \`run\` or task activation returns \`EXECUTION_ROOT_OCCUPIED\` or \`EXECUTION_ROOT_STALE\`, inspect or repair execution roots with \`superplan worktree list --json\` or \`superplan worktree ensure <change-slug> --json\` before editing in the wrong checkout
6. If \`run\`, \`status\`, or task activation returns any other unexpected lifecycle or runtime error, stay inside Superplan and repair, block, reopen, or inspect before attempting implementation
7. Update runtime state with block, feedback, complete, fix, and worktree-routing commands instead of editing markdown state by hand
8. After implementation proof passes, do not end the turn with the task still effectively pending or in progress; move it through \`superplan task review complete <task_ref> --json\` and the appropriate review path, or state the exact blocker
9. Use \`superplan context bootstrap --json\` when durable workspace context entrypoints are missing, then use CLI commands to keep context docs, decisions, gotchas, change plans, change specs, and tracked tasks honest instead of inventing ad hoc files
10. When shaping tracked work, use \`superplan change new --single-task\`, \`superplan change task add\`, \`superplan change plan set\`, and \`superplan change spec set\` instead of editing anything under the shared Superplan project state root directly
11. When the request is large, ambiguous, or multi-workstream, do not jump straight from the raw request into task scaffolding; clarify expectations, capture spec or plan truth when needed, then finalize the graph
12. If overlay support is enabled for this workspace and a launchable companion is installed, \`superplan task scaffold new\`, \`superplan task scaffold batch\`, \`superplan run\`, \`superplan run <task_ref>\`, and \`superplan task review reopen\` can auto-reveal the overlay when work becomes visible; on a fresh machine or after install/update, verify overlay health with \`superplan doctor --json\` and \`superplan overlay ensure --json\` before assuming it is working, and inspect launchability or companion errors if the reveal fails; use \`superplan overlay hide --json\` when it becomes idle or empty
13. After overlay-triggering commands, inspect the returned \`overlay\` payload; if \`overlay.companion.launched\` is false, surface \`overlay.companion.reason\` instead of assuming the overlay appeared

Authoring rule:
- Use \`superplan context bootstrap --json\` to create missing workspace context entrypoints instead of hand-writing them from scratch
- Use \`superplan change new <change-slug> --json\` once per tracked change
- Use \`superplan change new --single-task\` for the one-task fast path
- Use \`superplan change task add\` to define tracked work and let the CLI place graph and task-contract artifacts correctly
- Use \`superplan change plan set\` and \`superplan change spec set\` for change-scoped plan/spec truth
- Use \`superplan context doc set\` and \`superplan context log add\` for workspace-owned durable memory
- Do not edit anything under the shared Superplan project state root directly when a CLI command can own the write
- Prefer stdin over temp files in agent flows
- Use the returned task payloads directly after CLI authoring instead of immediately calling \`superplan task inspect show\`

Canonical selection rule:
- Prefer the one canonical command for the intent instead of choosing among overlapping alternatives
- Prefer commands that already return the needed task payload instead of making extra follow-up calls

User communication rule:
- Use \`control-plane mode\` by default for workflow control: keep orchestration internal, stay terse, and avoid phase narration
- Switch to \`planning mode\` only when the user is choosing an approach or when \`superplan-plan\` / \`superplan-brainstorm\` owns the next step
- In \`planning mode\`, make approaches, recommendation, trade-offs, and execution path explicit without foregrounding Superplan mechanics
- Progress updates should focus on user value: what is changing, what risk is being checked, what decision matters, or what blocker needs attention
- Prefer project thoughts over process thoughts

Never write shared runtime overlay state by hand.
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
