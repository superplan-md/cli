#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'output');
const skillsDir = path.join(outputDir, 'skills');

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

function copyFile(sourcePath, destinationPath) {
  ensureDirectory(path.dirname(destinationPath));
  fs.copyFileSync(sourcePath, destinationPath);
}

function listSkillFiles(rootPath) {
  const skillFiles = [];
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = path.join(rootPath, entry.name, 'SKILL.md');
    if (pathExists(skillPath)) {
      skillFiles.push({
        skillName: entry.name,
        skillPath,
      });
    }
  }

  return skillFiles;
}

console.log('Populating output directory...');

for (const relativeDir of [
  'agents/workflows',
  'claude/skills',
  'claude-plugin',
  'cursor/skills',
  'cursor-plugin',
  'opencode-plugin',
  'codex-plugin',
  'opencode/skills',
  'codex/skills',
  'gemini',
  'playwright',
]) {
  ensureDirectory(path.join(outputDir, relativeDir));
}

console.log('Populating Agents workflows...');
for (const { skillName, skillPath } of listSkillFiles(skillsDir)) {
  copyFile(skillPath, path.join(outputDir, 'agents', 'workflows', `${skillName}.md`));
}

console.log('Populating common skills...');
const commonSkillFilename = '00-superplan-principles.md';
for (const toolName of ['claude', 'cursor', 'opencode', 'codex']) {
  copyFile(
    path.join(skillsDir, commonSkillFilename),
    path.join(outputDir, toolName, 'skills', commonSkillFilename),
  );
}

const officeHoursSourcePath = path.join(repoRoot, '.codex', 'skills', 'office-hours');
if (pathExists(officeHoursSourcePath)) {
  fs.cpSync(
    officeHoursSourcePath,
    path.join(outputDir, 'codex', 'skills', 'office-hours'),
    { recursive: true, force: true },
  );
}

console.log('Fixing template paths...');
const geminiTemplatePath = path.join(outputDir, 'gemini', 'GEMINI.md');
if (pathExists(geminiTemplatePath)) {
  const geminiTemplate = fs.readFileSync(geminiTemplatePath, 'utf8');
  fs.writeFileSync(
    geminiTemplatePath,
    geminiTemplate.replace(/@\.\/*skills\//g, '@.superplan/skills/'),
    'utf8',
  );
}

console.log('Output directory populated successfully.');
