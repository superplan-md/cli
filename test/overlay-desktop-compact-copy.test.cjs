const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadCompactCopyModule() {
  return import(pathToFileURL(path.join(
    __dirname,
    '..',
    'apps',
    'overlay-desktop',
    'src',
    'lib',
    'compact-copy.js',
  )).href);
}

test('queued compact tasks use neutral copy instead of raw task description', async () => {
  const { getCompactFallbackDescription } = await loadCompactCopyModule();

  const description = getCompactFallbackDescription({
    status: 'backlog',
    description: 'Define the first acceptance criterion.',
  }, {
    secondaryLabel: 'Up next',
  });

  assert.equal(description, 'Queued as the next task.');
});

test('review-ready compact tasks keep the approval handoff copy', async () => {
  const { getCompactFallbackDescription } = await loadCompactCopyModule();

  const description = getCompactFallbackDescription({
    status: 'backlog',
    description: 'Any verbose task details',
  }, {
    reviewReady: true,
    secondaryLabel: 'Ready for review',
  });

  assert.equal(description, 'Task complete and waiting for approval.');
});
