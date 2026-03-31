const { test } = require('node:test');
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
  
  // Create a debug script inside the sandbox workspace
  const debugScript = `
    const { detectAgents } = require('${process.cwd()}/dist/cli/commands/install-helpers.js');
    async function main() {
      const agents = await detectAgents('${sandbox.cwd}', 'project');
      console.log(JSON.stringify(agents, null, 2));
    }
    main();
  `;
  await fs.writeFile(path.join(sandbox.cwd, 'debug.js'), debugScript);
  const out = require('child_process').execSync(`node debug.js`, { cwd: sandbox.cwd, env: sandbox.env });
  console.log(out.toString());
}

run().catch(console.error);
