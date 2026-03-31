#!/usr/bin/env node

const { execFileSync } = require('node:child_process');

const DEFAULT_WORKFLOW = 'overlay-release.yml';

function printUsage() {
  console.log(`Overlay GitHub release dispatcher

Usage:
  node scripts/overlay-release-dispatch.js --tag <release-tag> [options]

Options:
  --tag <tag>             GitHub release tag to create or update (required)
  --name <name>           Optional release title override
  --source-ref <ref>      Git ref or commit to build from (default: HEAD, or target repo default branch for cross-repo dispatch)
  --workflow-ref <ref>    Git ref that contains the workflow file (default: current branch, or target repo default branch for cross-repo dispatch)
  --workflow <file>       Workflow filename to dispatch (default: ${DEFAULT_WORKFLOW})
  --publish               Publish immediately instead of creating a draft release
  --prerelease            Mark the release as a prerelease
  --repo <owner/repo>     Explicit GitHub repository override
  --help                  Show this message
`);
}

function parseArgs(argv) {
  const parsed = {
    releaseTag: '',
    releaseName: '',
    sourceRef: '',
    workflowRef: '',
    workflowFile: DEFAULT_WORKFLOW,
    publish: false,
    prerelease: false,
    repo: '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === 'help') {
      parsed.help = true;
      continue;
    }

    if (arg === '--publish') {
      parsed.publish = true;
      continue;
    }

    if (arg === '--prerelease') {
      parsed.prerelease = true;
      continue;
    }

    if ((arg === '--tag' || arg === '--name' || arg === '--source-ref' || arg === '--workflow-ref' || arg === '--workflow' || arg === '--repo') && next) {
      const value = next.trim();
      index += 1;

      if (arg === '--tag') {
        parsed.releaseTag = value;
      } else if (arg === '--name') {
        parsed.releaseName = value;
      } else if (arg === '--source-ref') {
        parsed.sourceRef = value;
      } else if (arg === '--workflow-ref') {
        parsed.workflowRef = value;
      } else if (arg === '--workflow') {
        parsed.workflowFile = value;
      } else if (arg === '--repo') {
        parsed.repo = value;
      }
      continue;
    }

    throw new Error(`Unknown overlay-release-dispatch argument: ${arg}`);
  }

  return parsed;
}

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function runGh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeRepoSlug(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const directMatch = raw.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (directMatch) {
    return `${directMatch[1]}/${directMatch[2].replace(/\.git$/, '')}`;
  }

  const httpsMatch = raw.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const sshMatch = raw.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return raw.replace(/\.git$/, '');
}

function getDefaultSourceRef() {
  return runGit(['rev-parse', 'HEAD']);
}

function getDefaultWorkflowRef() {
  const branch = runGit(['branch', '--show-current']);
  return branch || getDefaultSourceRef();
}

function getCurrentRepoSlug() {
  try {
    return normalizeRepoSlug(runGit(['remote', 'get-url', 'origin']));
  } catch {
    return '';
  }
}

function getRepoDefaultBranch(repo) {
  const normalizedRepo = normalizeRepoSlug(repo);
  if (!normalizedRepo) {
    return '';
  }

  return runGh([
    'repo',
    'view',
    normalizedRepo,
    '--json',
    'defaultBranchRef',
    '--jq',
    '.defaultBranchRef.name',
  ]);
}

function buildWorkflowRunArgs(options) {
  const args = ['workflow', 'run', options.workflowFile];

  if (options.repo) {
    args.push('--repo', options.repo);
  }

  args.push(
    '--ref',
    options.workflowRef,
    '-f',
    `source_ref=${options.sourceRef}`,
    '-f',
    `release_tag=${options.releaseTag}`,
    '-f',
    `draft=${String(!options.publish)}`,
    '-f',
    `prerelease=${String(options.prerelease)}`,
  );

  if (options.releaseName) {
    args.push('-f', `release_name=${options.releaseName}`);
  }

  return args;
}

function ensureRequiredOptions(options) {
  if (!options.releaseTag) {
    throw new Error('Missing required --tag value.');
  }
}

function resolveDispatchOptions(options, deps = {}) {
  const resolved = {
    ...options,
    repo: normalizeRepoSlug(options.repo),
  };

  const getCurrentRepo = deps.getCurrentRepoSlug ?? getCurrentRepoSlug;
  const getDefaultSource = deps.getDefaultSourceRef ?? getDefaultSourceRef;
  const getDefaultWorkflow = deps.getDefaultWorkflowRef ?? getDefaultWorkflowRef;
  const getDefaultBranch = deps.getRepoDefaultBranch ?? getRepoDefaultBranch;

  const currentRepo = getCurrentRepo();
  const crossRepoDispatch = Boolean(resolved.repo) && (!currentRepo || resolved.repo !== currentRepo);
  const targetDefaultBranch = crossRepoDispatch ? (getDefaultBranch(resolved.repo) || 'main') : '';

  resolved.workflowRef = resolved.workflowRef || (crossRepoDispatch ? targetDefaultBranch : getDefaultWorkflow());
  resolved.sourceRef = resolved.sourceRef || (crossRepoDispatch ? resolved.workflowRef : getDefaultSource());

  return resolved;
}

function dispatchOverlayRelease(options) {
  ensureRequiredOptions(options);

  const resolved = resolveDispatchOptions(options);
  const args = buildWorkflowRunArgs(resolved);
  execFileSync('gh', args, {
    stdio: 'inherit',
  });

  return resolved;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printUsage();
    return;
  }

  const resolved = dispatchOverlayRelease(args);
  console.log(`Dispatched ${resolved.workflowFile} for ${resolved.releaseTag} from ${resolved.sourceRef}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message || String(error));
    process.exit(1);
  }
}

module.exports = {
  DEFAULT_WORKFLOW,
  buildWorkflowRunArgs,
  dispatchOverlayRelease,
  parseArgs,
  resolveDispatchOptions,
  normalizeRepoSlug,
};
