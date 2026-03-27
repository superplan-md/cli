import * as path from 'path';
import { ALL_ENTRY_SKILL_NAMES, CURRENT_SUPERPLAN_SKILL_NAMES } from './skill-names';
export { ALL_ENTRY_SKILL_NAMES, CURRENT_SUPERPLAN_SKILL_NAMES };

export type AgentName =
  | 'amazonq'
  | 'antigravity'
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'gemini'
  | 'opencode'
  | 'copilot';

export type AgentScope = 'global' | 'project';
export type AgentInstallKind = 'toml_command' | 'skills_namespace' | 'pointer_rule' | 'markdown_rule' | 'managed_global_rule' | 'amazonq_rules' | 'antigravity_workflows';
export type AgentBootstrapStrength = 'context_bootstrap' | 'rule_bootstrap' | 'skills_only';

export interface AgentEnvironment {
  name: AgentName;
  path: string;
  install_path?: string;
  settings_path?: string;
  install_kind?: AgentInstallKind;
  bootstrap_strength: AgentBootstrapStrength;
  cleanup_paths?: string[];
}

export const AGENT_DISPLAY_NAMES: Record<AgentName, string> = {
  amazonq: 'Amazon Q',
  antigravity: 'Antigravity',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  copilot: 'GitHub Copilot',
};

export const AGENT_SELECTION_ORDER: AgentName[] = [
  'claude',
  'codex',
  'gemini',
  'cursor',
  'opencode',
  'amazonq',
  'antigravity',
  'copilot',
];

export function getSkillsNamespaceCandidates(baseDir: string, ...segments: string[]): string[] {
  return ALL_ENTRY_SKILL_NAMES.map(skillName => path.join(baseDir, ...segments, skillName));
}

export function getSkillsFileCandidates(baseDir: string, ...segments: string[]): string[] {
  return ALL_ENTRY_SKILL_NAMES.map(skillName => path.join(baseDir, ...segments, skillName, 'SKILL.md'));
}

export function getAntigravityWorkflowCandidates(baseDir: string, ...segments: string[]): string[] {
  return CURRENT_SUPERPLAN_SKILL_NAMES.map(skillName => path.join(baseDir, ...segments, `${skillName}.md`));
}

export function getBootstrapStrengthSummary(strength: AgentBootstrapStrength): string {
  if (strength === 'context_bootstrap') {
    return 'bootstrap context';
  }

  if (strength === 'rule_bootstrap') {
    return 'always-on rules';
  }

  return 'skill discovery only';
}
