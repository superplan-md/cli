const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadRuntimeHelpersModule() {
  return import(pathToFileURL(path.join(
    __dirname,
    '..',
    'apps',
    'overlay-desktop',
    'src',
    'lib',
    'runtime-helpers.js',
  )).href);
}

test('browser fallback snapshot includes live and completed task timing cues', async () => {
  const { getBrowserFallbackSnapshot } = await loadRuntimeHelpersModule();

  const snapshot = getBrowserFallbackSnapshot('/tmp/workspace');

  assert.equal(snapshot.workspace_path, '/tmp/workspace');
  assert.equal(snapshot.attention_state, 'normal');
  assert.equal(snapshot.active_task?.status, 'in_progress');
  assert.equal(snapshot.active_task?.started_at, '2026-03-19T21:56:00.000Z');
  assert.equal(snapshot.board.in_progress.length, 1);
  assert.equal(snapshot.board.done.length > 0, true);
  assert.equal(snapshot.board.done[0].completed_at, '2026-03-19T21:19:00.000Z');
  assert.equal(snapshot.board.blocked[0].reason.includes('fullscreen'), true);
  assert.deepEqual(snapshot.events, []);
});

test('tauri window availability guard returns false when the runtime getter throws', async () => {
  const { isTauriWindowAvailable } = await loadRuntimeHelpersModule();

  assert.equal(isTauriWindowAvailable(() => {
    throw new TypeError('missing metadata');
  }), false);

  assert.equal(isTauriWindowAvailable(() => ({ label: 'main' })), true);
});
