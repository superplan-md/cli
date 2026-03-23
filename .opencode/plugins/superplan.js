/**
 * Superplan plugin for OpenCode.ai
 *
 * Injects superplan-entry bootstrap context via system prompt transform.
 * Auto-registers the bundled skills directory for discovery.
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const extractAndStripFrontmatter = content => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content };
  }

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: match[2] };
};

const normalizePath = (targetPath, homeDir) => {
  if (!targetPath || typeof targetPath !== 'string') {
    return null;
  }

  let normalized = targetPath.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith('~/')) {
    normalized = path.join(homeDir, normalized.slice(2));
  } else if (normalized === '~') {
    normalized = homeDir;
  }

  return path.resolve(normalized);
};

export const SuperplanPlugin = async () => {
  const homeDir = os.homedir();
  const superplanSkillsDir = path.resolve(__dirname, '../../skills');
  const envConfigDir = normalizePath(process.env.OPENCODE_CONFIG_DIR, homeDir);
  const configDir = envConfigDir || path.join(homeDir, '.config/opencode');

  const getBootstrapContent = () => {
    const skillPath = path.join(superplanSkillsDir, 'superplan-entry', 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      return null;
    }

    const fullContent = fs.readFileSync(skillPath, 'utf8');
    const { content } = extractAndStripFrontmatter(fullContent);

    const toolMapping = `**Tool Mapping for OpenCode:**
When Superplan skills reference tools you do not have, substitute OpenCode equivalents:
- \`TodoWrite\` -> \`todowrite\`
- subagent dispatch -> OpenCode's \`@mention\` flow
- skill loading -> OpenCode's native \`skill\` tool
- file and shell operations -> native OpenCode tools

**Skills location:**
Superplan skills are available from \`${configDir}/skills/superplan/\` when installed through host config.`;

    return `<EXTREMELY_IMPORTANT>
Superplan is available in this repository.

**IMPORTANT: The \`superplan-entry\` skill content is included below. It is ALREADY LOADED. Follow it before implementation, broad repo exploration, or clarifying questions for repo work. Do not load \`superplan-entry\` again redundantly.**

${content}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
  };

  return {
    config: async config => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(superplanSkillsDir)) {
        config.skills.paths.push(superplanSkillsDir);
      }
    },
    'experimental.chat.system.transform': async (_input, output) => {
      const bootstrap = getBootstrapContent();
      if (bootstrap) {
        (output.system ||= []).push(bootstrap);
      }
    },
  };
};
