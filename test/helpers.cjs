const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const DIST_MAIN = path.join(REPO_ROOT, 'dist', 'cli', 'main.js');

async function makeSandbox(prefix = 'superplan-test-') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const cwd = path.join(root, 'workspace');
  const home = path.join(root, 'home');

  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(home, { recursive: true });

  return {
    root,
    cwd,
    home,
    env: {
      ...process.env,
      HOME: home,
    },
  };
}

async function writeFile(targetPath, content) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, 'utf-8');
}

async function writeJson(targetPath, value) {
  await writeFile(targetPath, JSON.stringify(value, null, 2));
}

async function readJson(targetPath) {
  const content = await fs.readFile(targetPath, 'utf-8');
  return JSON.parse(content);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function parseCliJson(result) {
  const output = (result.stdout || result.stderr).trim();
  return JSON.parse(output);
}

async function runCli(args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [DIST_MAIN, ...args], {
      cwd: options.cwd ?? REPO_ROOT,
      env: {
        ...process.env,
        ...(options.env ?? {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.stdin.on('error', error => {
      if (error && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')) {
        return;
      }

      reject(error);
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }

    child.on('close', code => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

function clearDistModuleCache() {
  const distRoot = path.join(REPO_ROOT, 'dist');
  for (const moduleId of Object.keys(require.cache)) {
    if (moduleId.startsWith(distRoot)) {
      delete require.cache[moduleId];
    }
  }
}

function loadDistModule(relativePath, promptOverrides) {
  clearDistModuleCache();

  const promptsModuleId = require.resolve('@inquirer/prompts');
  const previousPromptModule = require.cache[promptsModuleId];
  const promptExports = previousPromptModule?.exports ?? require('@inquirer/prompts');

  if (promptOverrides) {
    require.cache[promptsModuleId] = {
      id: promptsModuleId,
      filename: promptsModuleId,
      loaded: true,
      exports: {
        ...promptExports,
        ...promptOverrides,
      },
    };
  }

  const loadedModule = require(path.join(REPO_ROOT, 'dist', relativePath));

  if (promptOverrides) {
    if (previousPromptModule) {
      require.cache[promptsModuleId] = previousPromptModule;
    } else {
      delete require.cache[promptsModuleId];
    }
  }

  return loadedModule;
}

async function withSandboxEnv(sandbox, fn) {
  const previousCwd = process.cwd();
  const previousHome = process.env.HOME;

  process.chdir(sandbox.cwd);
  process.env.HOME = sandbox.home;

  try {
    return await fn();
  } finally {
    process.chdir(previousCwd);
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

module.exports = {
  DIST_MAIN,
  REPO_ROOT,
  loadDistModule,
  makeSandbox,
  parseCliJson,
  pathExists,
  readJson,
  runCli,
  withSandboxEnv,
  writeFile,
  writeJson,
};
