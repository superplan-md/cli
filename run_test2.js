const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs/promises');
const { makeSandbox, runCli, parseCliJson, pathExists } = require('./test/helpers.cjs');

async function run() {
  const sandbox = await makeSandbox('superplan-init-claude-root-');

  const g = await runCli(['init', '--global', '--quiet', '--json'], { cwd: sandbox.cwd, env: sandbox.env });
  console.log('Global init:', g.stdout);
  
  const registry = await fs.readFile(path.join(sandbox.home, '.config', 'superplan', 'install.json'), 'utf-8').catch(()=>'{}');
  console.log('Registry:', registry);
}

run().catch(console.error);
