#!/usr/bin/env node
import { routeCommand, router } from './router';

function printHelp() {
  console.log(`Superplan CLI

Usage:
  superplan <command>

Commands:
  init        Initialize Superplan in this repo
  setup       Setup Superplan globally
  doctor      Validate setup
  parse       Parse superplan artifacts
  task        Task operations

Options:
  --json      Output JSON for agents`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const json = args.includes('--json');

  if (command === undefined || command === '--json') {
    if (json) {
      console.error(JSON.stringify({
        ok: false,
        error: {
          code: 'NO_COMMAND',
          message: 'No command provided',
          retryable: false,
        },
      }, null, 2));
      process.exitCode = 1;
      return;
    }

    printHelp();
    return;
  }

  if (!(command in router)) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: 'UNKNOWN_COMMAND',
        message: `Unknown command: ${command}`,
        retryable: false,
      },
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  await routeCommand(args);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
