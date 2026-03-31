const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const {
  makeSandbox,
  getSuperplanRoot,
} = require('./helpers.cjs');
const { writeVisibilityExamples } = require('../scripts/visibility-scenarios.js');

test('visibility examples harness writes paired scenario markdown and json artifacts', async () => {
  const sandbox = await makeSandbox('superplan-visibility-examples-');

  const result = await writeVisibilityExamples({ rootDir: sandbox.cwd });
  assert.equal(result.scenarios.length, 3);

  const readme = await fs.readFile(path.join(sandbox.cwd, 'docs', 'examples', 'visibility', 'README.md'), 'utf-8');
  assert.match(readme, /Visibility Examples/);
  assert.match(readme, /Interruption Recovery/);
  assert.match(readme, /Needs Feedback Handoff/);
  assert.match(readme, /Review Reopen Correction/);

  const scenarioJson = JSON.parse(await fs.readFile(
    path.join(sandbox.cwd, 'docs', 'examples', 'visibility', 'needs-feedback-handoff.json'),
    'utf-8',
  ));
  assert.equal(scenarioJson.baseline.mode, 'raw_claude_code');

  const scenarioMarkdown = await fs.readFile(
    path.join(sandbox.cwd, 'docs', 'examples', 'visibility', 'review-reopen-correction.md'),
    'utf-8',
  );
  assert.match(scenarioMarkdown, /Measured Deltas/);
  assert.match(scenarioMarkdown, /Late failure visibility/);
});
