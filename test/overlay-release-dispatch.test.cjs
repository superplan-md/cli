const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { REPO_ROOT } = require('./helpers.cjs');

test('overlay release dispatch parses explicit options', () => {
  const { parseArgs } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release-dispatch.js'));

  const parsed = parseArgs([
    'node',
    'scripts/overlay-release-dispatch.js',
    '--tag',
    'alpha.99',
    '--name',
    'Alpha 99',
    '--source-ref',
    'abc123',
    '--workflow-ref',
    'release-branch',
    '--workflow',
    'custom.yml',
    '--publish',
    '--prerelease',
    '--repo',
    'superplan-md/cli',
  ]);

  assert.deepEqual(parsed, {
    releaseTag: 'alpha.99',
    releaseName: 'Alpha 99',
    sourceRef: 'abc123',
    workflowRef: 'release-branch',
    workflowFile: 'custom.yml',
    publish: true,
    prerelease: true,
    repo: 'superplan-md/cli',
  });
});

test('overlay release dispatch builds workflow arguments with draft by default', () => {
  const { buildWorkflowRunArgs } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release-dispatch.js'));

  const args = buildWorkflowRunArgs({
    workflowFile: 'overlay-release.yml',
    workflowRef: 'main',
    sourceRef: 'deadbeef',
    releaseTag: 'alpha.100',
    releaseName: '',
    publish: false,
    prerelease: false,
    repo: '',
  });

  assert.deepEqual(args, [
    'workflow',
    'run',
    'overlay-release.yml',
    '--ref',
    'main',
    '-f',
    'source_ref=deadbeef',
    '-f',
    'release_tag=alpha.100',
    '-f',
    'draft=true',
    '-f',
    'prerelease=false',
  ]);
});

test('overlay release dispatch includes release name and repo when provided', () => {
  const { buildWorkflowRunArgs } = require(path.join(REPO_ROOT, 'scripts', 'overlay-release-dispatch.js'));

  const args = buildWorkflowRunArgs({
    workflowFile: 'overlay-release.yml',
    workflowRef: 'feature/releases',
    sourceRef: 'cafebabe',
    releaseTag: 'alpha.101',
    releaseName: 'Alpha 101',
    publish: true,
    prerelease: true,
    repo: 'superplan-md/cli',
  });

  assert.deepEqual(args, [
    'workflow',
    'run',
    'overlay-release.yml',
    '--repo',
    'superplan-md/cli',
    '--ref',
    'feature/releases',
    '-f',
    'source_ref=cafebabe',
    '-f',
    'release_tag=alpha.101',
    '-f',
    'draft=false',
    '-f',
    'prerelease=true',
    '-f',
    'release_name=Alpha 101',
  ]);
});
