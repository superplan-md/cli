const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  loadDistModule,
  makeSandbox,
  withSandboxEnv,
  writeFile,
} = require('./helpers.cjs');

test('workflow surface detection summarizes repo-native planning, execution, and verification surfaces', async () => {
  const sandbox = await makeSandbox('superplan-workflow-surfaces-');
  const { detectWorkflowSurfaces } = loadDistModule('cli/workflow-surfaces.js');

  await writeFile(path.join(sandbox.cwd, '.codex', 'skills', 'plan-work', 'SKILL.md'), '# plan');
  await writeFile(path.join(sandbox.cwd, '.codex', 'skills', 'review-app', 'SKILL.md'), '# review');
  await writeFile(path.join(sandbox.cwd, '.agents', 'workflows', 'execute-feature.md'), '# execute');
  await writeFile(path.join(sandbox.cwd, '.github', 'copilot-instructions.md'), '# instructions');
  await writeFile(path.join(sandbox.cwd, 'package.json'), JSON.stringify({
    scripts: {
      start: 'node index.js',
      test: 'node --test',
      'verify:ui': 'npm test',
      'plan:feature': 'echo planned',
    },
  }, null, 2));

  const summary = await withSandboxEnv(sandbox, async () => detectWorkflowSurfaces());

  assert.equal(await fs.realpath(summary.workspace_root), await fs.realpath(sandbox.cwd));
  assert.equal(summary.native_harness_paths.includes('.codex'), true);
  assert.equal(summary.native_harness_paths.includes('.agents'), true);
  assert.equal(summary.planning_surfaces.includes('codex skill: plan-work'), true);
  assert.equal(summary.planning_surfaces.includes('package script: plan:feature'), true);
  assert.equal(summary.execution_surfaces.includes('workflow: execute-feature'), true);
  assert.equal(summary.execution_surfaces.includes('package script: npm start'), true);
  assert.equal(summary.verification_surfaces.includes('codex skill: review-app'), true);
  assert.equal(summary.verification_surfaces.includes('copilot instructions: .github/copilot-instructions.md'), true);
  assert.equal(summary.verification_surfaces.includes('package script: npm test'), true);
  assert.equal(summary.verification_surfaces.includes('package script: npm run verify:ui'), true);
});

test('task recipe inference lifts repo-native verification surfaces into notes and commands', async () => {
  const sandbox = await makeSandbox('superplan-workflow-recipe-');
  const { resolveTaskRecipe } = loadDistModule('cli/task-execution.js');

  await writeFile(path.join(sandbox.cwd, '.codex', 'skills', 'verify-ui', 'SKILL.md'), '# verify');
  await writeFile(path.join(sandbox.cwd, '.agents', 'workflows', 'review-ui.md'), '# review');
  await writeFile(path.join(sandbox.cwd, 'package.json'), JSON.stringify({
    scripts: {
      build: 'tsc',
      test: 'node --test',
      lint: 'eslint .',
    },
  }, null, 2));

  const recipe = await withSandboxEnv(sandbox, async () => resolveTaskRecipe({
    title: 'Tighten UI verification',
    description: 'Update app chrome and prove the UI still works',
    acceptance_criteria: [
      { text: 'UI changes are verified against repo-native checks.' },
    ],
  }));

  assert.equal(recipe.source, 'repo_inferred');
  assert.deepEqual(recipe.verify_commands, ['npm run build', 'npm test', 'npm run lint']);
  assert.equal(recipe.notes.some(note => note.includes('Repo-native verification surfaces:')), true);
  assert.equal(recipe.notes.some(note => note.includes('codex skill: verify-ui')), true);
  assert.equal(recipe.notes.some(note => note.includes('workflow: review-ui')), true);
});
