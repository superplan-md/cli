#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUNDLE_ROOT = path.join(
  REPO_ROOT,
  'apps',
  'overlay-desktop',
  'src-tauri',
  'target',
  'release',
  'bundle',
);
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'dist', 'release', 'overlay');

function normalizePlatform(rawPlatform) {
  if (rawPlatform === 'darwin' || rawPlatform === 'linux') {
    return rawPlatform;
  }

  if (rawPlatform === 'macos') {
    return 'darwin';
  }

  throw new Error(`Unsupported overlay release platform: ${rawPlatform}`);
}

function normalizeArch(rawArch) {
  if (rawArch === 'x64' || rawArch === 'arm64') {
    return rawArch;
  }

  if (rawArch === 'x86_64' || rawArch === 'amd64') {
    return 'x64';
  }

  if (rawArch === 'aarch64') {
    return 'arm64';
  }

  throw new Error(`Unsupported overlay release arch: ${rawArch}`);
}

function getOverlayReleaseTarget(rawPlatform = process.platform, rawArch = process.arch) {
  const platform = normalizePlatform(rawPlatform);
  const arch = normalizeArch(rawArch);

  if (platform === 'darwin') {
    return {
      platform,
      arch,
      artifactName: `superplan-overlay-${platform}-${arch}.tar.gz`,
      artifactKind: 'tar.gz',
      bundleDirectory: 'macos',
      bundleExtension: '.app',
    };
  }

  return {
    platform,
    arch,
    artifactName: `superplan-overlay-${platform}-${arch}.AppImage`,
    artifactKind: 'file',
    bundleDirectory: 'appimage',
    bundleExtension: '.AppImage',
  };
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findBundleInput(bundleRoot, target) {
  const platformBundleDir = path.join(bundleRoot, target.bundleDirectory);
  if (!await pathExists(platformBundleDir)) {
    throw new Error(`Expected overlay bundle directory is missing: ${platformBundleDir}`);
  }

  const entries = await fsp.readdir(platformBundleDir, { withFileTypes: true });
  const matches = entries
    .filter(entry => entry.name.endsWith(target.bundleExtension))
    .map(entry => path.join(platformBundleDir, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    throw new Error(`No ${target.bundleExtension} overlay bundle found in ${platformBundleDir}`);
  }

  return matches[0];
}

async function ensureDirectory(targetPath) {
  await fsp.mkdir(targetPath, { recursive: true });
}

async function packageOverlayRelease(options = {}) {
  const target = getOverlayReleaseTarget(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  const bundleRoot = path.resolve(options.bundleRoot ?? DEFAULT_BUNDLE_ROOT);
  const outputDir = path.resolve(options.outputDir ?? DEFAULT_OUTPUT_DIR);
  const bundleInputPath = path.resolve(options.bundleInputPath ?? await findBundleInput(bundleRoot, target));
  const artifactPath = path.join(outputDir, target.artifactName);

  await ensureDirectory(outputDir);
  await fsp.rm(artifactPath, { force: true });

  if (target.artifactKind === 'tar.gz') {
    execFileSync('tar', ['-czf', artifactPath, '-C', path.dirname(bundleInputPath), path.basename(bundleInputPath)], {
      stdio: 'inherit',
    });
  } else {
    await fsp.copyFile(bundleInputPath, artifactPath);
    await fsp.chmod(artifactPath, 0o755);
  }

  return {
    ...target,
    bundleInputPath,
    artifactPath,
    outputDir,
  };
}

function printUsage() {
  console.log(`Overlay release helper

Usage:
  node scripts/overlay-release.js target [--platform <platform>] [--arch <arch>]
  node scripts/overlay-release.js package [--platform <platform>] [--arch <arch>] [--bundle-root <path>] [--output-dir <path>] [--bundle-input <path>]
`);
}

function parseArgs(argv) {
  const parsed = {
    command: argv[2],
    platform: undefined,
    arch: undefined,
    bundleRoot: undefined,
    outputDir: undefined,
    bundleInputPath: undefined,
  };

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--platform' && next) {
      parsed.platform = next;
      index += 1;
      continue;
    }

    if (arg === '--arch' && next) {
      parsed.arch = next;
      index += 1;
      continue;
    }

    if (arg === '--bundle-root' && next) {
      parsed.bundleRoot = next;
      index += 1;
      continue;
    }

    if (arg === '--output-dir' && next) {
      parsed.outputDir = next;
      index += 1;
      continue;
    }

    if (arg === '--bundle-input' && next) {
      parsed.bundleInputPath = next;
      index += 1;
      continue;
    }

    throw new Error(`Unknown overlay-release argument: ${arg}`);
  }

  return parsed;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.command || args.command === '--help' || args.command === 'help') {
    printUsage();
    return;
  }

  if (args.command === 'target') {
    console.log(JSON.stringify(getOverlayReleaseTarget(args.platform, args.arch), null, 2));
    return;
  }

  if (args.command === 'package') {
    const result = await packageOverlayRelease({
      platform: args.platform,
      arch: args.arch,
      bundleRoot: args.bundleRoot,
      outputDir: args.outputDir,
      bundleInputPath: args.bundleInputPath,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  throw new Error(`Unknown overlay-release command: ${args.command}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_BUNDLE_ROOT,
  DEFAULT_OUTPUT_DIR,
  getOverlayReleaseTarget,
  packageOverlayRelease,
};
