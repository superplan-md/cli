const path = require('node:path');
const fs = require('node:fs/promises');
const { makeSandbox, runCli, parseCliJson } = require('./test/helpers.cjs');

async function run() {
  const sandbox = await makeSandbox('superplan-init-claude-root-');
  await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  
  const agentsJsonPath = path.join(sandbox.home, '.config', 'superplan', 'agents.json');
  console.log('agents.json:', await fs.readFile(agentsJsonPath, 'utf-8').catch(() => 'not found'));
}

run().catch(console.error);
