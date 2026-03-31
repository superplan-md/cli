#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_APP_DIR = path.join(REPO_ROOT, 'apps', 'desktop');
const DEFAULT_BUNDLE_ROOT = path.join(DEFAULT_APP_DIR, 'dist');
const DEFAULT_OUTPUT_DIR = path.join(REPO_ROOT, 'dist', 'release', 'overlay');

function normalizePlatform(rawPlatform) {
  if (rawPlatform === 'darwin' || rawPlatform === 'linux' || rawPlatform === 'windows') {
    return rawPlatform;
  }

  if (rawPlatform === 'macos') {
    return 'darwin';
  }

  if (rawPlatform === 'win32') {
    return 'windows';
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
      bundleExtension: '.app',
    };
  }

  if (platform === 'windows') {
    return {
      platform,
      arch,
      artifactName: `superplan-overlay-${platform}-${arch}.exe`,
      artifactKind: 'file',
      bundleExtension: '.exe',
    };
  }

  return {
    platform,
    arch,
    artifactName: `superplan-overlay-${platform}-${arch}.AppImage`,
    artifactKind: 'file',
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

async function ensureDirectory(targetPath) {
  await fsp.mkdir(targetPath, { recursive: true });
}

function getPnpmCommand() {
  return process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

function runPnpm(args, appDir) {
  execFileSync(getPnpmCommand(), ['--dir', appDir, ...args], {
    stdio: 'inherit',
  });
}

function getElectronBuilderArgs(target) {
  const args = ['exec', 'electron-builder', '--publish', 'never'];

  if (target.arch === 'x64') {
    args.push('--x64');
  } else if (target.arch === 'arm64') {
    args.push('--arm64');
  }

  if (target.platform === 'darwin') {
    args.push('--mac', '--dir');
    return args;
  }

  if (target.platform === 'windows') {
    args.push('--win', 'portable');
    return args;
  }

  args.push('--linux', 'AppImage');
  return args;
}

async function findMacosBundleInput(bundleRoot) {
  const entries = await fsp.readdir(bundleRoot, { withFileTypes: true });
  const matches = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('mac')) {
      continue;
    }

    const appBundlePath = path.join(bundleRoot, entry.name, 'Superplan.app');
    if (await pathExists(appBundlePath)) {
      matches.push(appBundlePath);
    }
  }

  matches.sort((left, right) => left.localeCompare(right));
  if (matches.length === 0) {
    throw new Error(`No Superplan.app overlay bundle found under ${bundleRoot}`);
  }

  return matches[0];
}

async function findLinuxBundleInput(bundleRoot) {
  const entries = await fsp.readdir(bundleRoot, { withFileTypes: true });
  const matches = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.AppImage'))
    .map(entry => path.join(bundleRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    throw new Error(`No .AppImage overlay bundle found in ${bundleRoot}`);
  }

  return matches[0];
}

async function findWindowsBundleInput(bundleRoot) {
  const entries = await fsp.readdir(bundleRoot, { withFileTypes: true });
  const matches = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.exe') && /portable/i.test(entry.name))
    .map(entry => path.join(bundleRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (matches.length === 0) {
    throw new Error(`No portable Windows overlay build found in ${bundleRoot}`);
  }

  return matches[0];
}

async function findBundleInput(bundleRoot, target) {
  if (target.platform === 'darwin') {
    return findMacosBundleInput(bundleRoot);
  }

  if (target.platform === 'windows') {
    return findWindowsBundleInput(bundleRoot);
  }

  return findLinuxBundleInput(bundleRoot);
}

function adHocSignMacosBundleIfSupported(bundleInputPath, target) {
  if (target.platform !== 'darwin' || process.platform !== 'darwin') {
    return;
  }

  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundleInputPath], {
    stdio: 'inherit',
  });
}

async function buildOverlayRelease(options = {}) {
  const target = getOverlayReleaseTarget(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  const appDir = path.resolve(options.appDir ?? DEFAULT_APP_DIR);

  runPnpm(['run', 'build'], appDir);
  runPnpm(getElectronBuilderArgs(target), appDir);

  return {
    ...target,
    appDir,
    bundleRoot: path.join(appDir, 'dist'),
  };
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
    adHocSignMacosBundleIfSupported(bundleInputPath, target);
    execFileSync('tar', ['-czf', artifactPath, '-C', path.dirname(bundleInputPath), path.basename(bundleInputPath)], {
      stdio: 'inherit',
    });
  } else {
    await fsp.copyFile(bundleInputPath, artifactPath);
    await fsp.chmod(artifactPath, 0o755).catch(() => {});
  }

  return {
    ...target,
    bundleInputPath,
    artifactPath,
    outputDir,
  };
}

async function buildAndPackageOverlayRelease(options = {}) {
  const buildResult = await buildOverlayRelease(options);
  const packageResult = await packageOverlayRelease({
    ...options,
    platform: buildResult.platform,
    arch: buildResult.arch,
    bundleRoot: buildResult.bundleRoot,
  });

  return {
    ...packageResult,
    appDir: buildResult.appDir,
  };
}

function printUsage() {
  console.log(`Overlay release helper

Usage:
  node scripts/overlay-release.js target [--platform <platform>] [--arch <arch>]
  node scripts/overlay-release.js build [--platform <platform>] [--arch <arch>] [--app-dir <path>]
  node scripts/overlay-release.js package [--platform <platform>] [--arch <arch>] [--bundle-root <path>] [--output-dir <path>] [--bundle-input <path>]
  node scripts/overlay-release.js build-package [--platform <platform>] [--arch <arch>] [--app-dir <path>] [--output-dir <path>]
`);
}

function parseArgs(argv) {
  const parsed = {
    command: argv[2],
    platform: undefined,
    arch: undefined,
    appDir: undefined,
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

    if (arg === '--app-dir' && next) {
      parsed.appDir = next;
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

  if (args.command === 'build') {
    const result = await buildOverlayRelease({
      platform: args.platform,
      arch: args.arch,
      appDir: args.appDir,
    });
    console.log(JSON.stringify(result, null, 2));
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

  if (args.command === 'build-package') {
    const result = await buildAndPackageOverlayRelease({
      platform: args.platform,
      arch: args.arch,
      appDir: args.appDir,
      outputDir: args.outputDir,
      bundleRoot: args.bundleRoot,
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
  DEFAULT_APP_DIR,
  DEFAULT_BUNDLE_ROOT,
  DEFAULT_OUTPUT_DIR,
  REPO_ROOT,
  buildAndPackageOverlayRelease,
  buildOverlayRelease,
  getElectronBuilderArgs,
  getOverlayReleaseTarget,
  packageOverlayRelease,
  parseArgs,
};
