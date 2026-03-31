const path = require('node:path');
const fs = require('node:fs/promises');
const { makeSandbox, runCli, parseCliJson, pathExists } = require('./test/helpers.cjs');

async function run() {
  const sandbox = await makeSandbox('superplan-init-claude-root-');

  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  await fs.writeFile(path.join(sandbox.cwd, 'CLAUDE.md'), '# repo claude prefs\n');
  await fs.mkdir(path.join(sandbox.cwd, '.claude'), { recursive: true });
  await fs.writeFile(
    path.join(sandbox.cwd, '.claude', 'settings.local.json'),
    `${JSON.stringify({
      permissions: { allow: ['Bash(superplan init:*)'] },
      hooks: { sessionStart: [{ command: './session-start' }] },
    }, null, 2)}\n`,
  );

  const initResult = await runCli(['init', '--local', '--yes', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  console.log('INIT STDERR:', initResult.stderr);
  console.log('INIT STDOUT:', initResult.stdout);
  console.log('CLAUDE EXISTS:', await pathExists(path.join(sandbox.cwd, '.claude', 'CLAUDE.md')));
}

run().catch(console.error);
