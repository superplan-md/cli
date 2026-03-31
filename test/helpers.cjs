const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');

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

function getWorkspaceDirName(workspacePath) {
  const workspaceName = path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9]/g, '-');
  return `workspace-${workspaceName || 'root'}`;
}

function sanitizeSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function resolveRealPath(targetPath) {
  try {
    return require('fs').realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function resolveGitPath(workspaceRoot, flag) {
  const result = require('child_process').spawnSync('git', ['-C', workspaceRoot, 'rev-parse', flag], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    return null;
  }

  const output = result.stdout.trim();
  if (!output) {
    return null;
  }

  return resolveRealPath(path.isAbsolute(output) ? output : path.resolve(workspaceRoot, output));
}

function getSuperplanRoot(sandbox, targetCwd = sandbox ? sandbox.cwd : process.cwd()) {
  let currentDir = targetCwd;
  let gitRoot = null;
  while (true) {
    try {
      require('fs').accessSync(path.join(currentDir, '.git'));
      gitRoot = currentDir;
      break;
    } catch {
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
  }
  const workspacePath = gitRoot || targetCwd;
  const home = sandbox ? sandbox.home : process.env.HOME;
  const gitCommonDir = resolveGitPath(workspacePath, '--git-common-dir');
  const identitySource = gitCommonDir || resolveRealPath(workspacePath);
  const projectHash = createHash('sha1').update(identitySource).digest('hex').slice(0, 10);
  const baseName = path.basename(identitySource) === '.git'
    ? path.basename(path.dirname(identitySource))
    : path.basename(identitySource);
  const projectName = sanitizeSegment(baseName || path.basename(workspacePath) || 'root') || 'root';
  return path.join(home, '.config', 'superplan', `project-${projectName}-${projectHash}`);
}

async function writeChangeGraph(rootDir, changeSlug, options = {}, sandbox = null) {
  const title = options.title ?? changeSlug;
  const entries = options.entries ?? [];
  const notes = options.notes ?? [
    'Author the graph here before scaffolding task contracts with the CLI.',
  ];
  const workstreams = options.workstreams ?? [];
  const graphLines = [
    '# Task Graph',
    '',
    '## Graph Metadata',
    `- Change ID: \`${changeSlug}\``,
    `- Title: ${title}`,
    '',
    '## Graph Layout',
    ...entries.flatMap(entry => {
      const lines = [
        `- \`${entry.task_id}\` ${entry.title}`,
        `  - depends_on_all: [${(entry.depends_on_all ?? []).map(value => `\`${value}\``).join(', ')}]`,
        `  - depends_on_any: [${(entry.depends_on_any ?? []).map(value => `\`${value}\``).join(', ')}]`,
      ];

      if (entry.workstream) {
        lines.push(`  - workstream: \`${entry.workstream}\``);
      }

      if (entry.exclusive_group) {
        lines.push(`  - exclusive_group: \`${entry.exclusive_group}\``);
      }

      return lines;
    }),
    '',
  ];

  if (workstreams.length > 0) {
    graphLines.push('## Workstreams');
    graphLines.push(...workstreams.map(workstream => `- \`${workstream.id}\` ${workstream.title}`));
    graphLines.push('');
  }

  graphLines.push('## Notes');
  graphLines.push(...notes.map(note => `- ${note}`));
  graphLines.push('');

    // Infer sandbox from rootDir
  const inferredSandbox = sandbox || {
    cwd: rootDir,
    home: require('path').join(require('path').dirname(rootDir), 'home')
  };
  const superplanRoot = getSuperplanRoot(inferredSandbox, rootDir);

  await fs.mkdir(path.join(superplanRoot, 'changes', changeSlug, 'tasks'), { recursive: true });
  await writeFile(
    path.join(superplanRoot, 'changes', changeSlug, 'tasks.md'),
    graphLines.join('\n'),
  );
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
  getSuperplanRoot,
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
  writeChangeGraph,
  writeJson,
};
