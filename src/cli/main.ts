#!/usr/bin/env node
import { routeCommand, router } from './router';
import { getChangeCommandHelpMessage } from './commands/change';
import { getContextCommandHelpMessage } from './commands/context';
import { getTaskCommandHelpMessage } from './commands/task';
import { getOverlayCommandHelpMessage } from './commands/overlay';
import { getVisibilityCommandHelpMessage } from './commands/visibility';
import { getRemoveCommandHelpMessage } from './commands/remove';
import { getInstallCommandHelpMessage } from './commands/install';
import { getInitCommandHelpMessage } from './commands/init';
import { stopNextAction, type NextAction } from './next-action';

const { version } = require('../../package.json') as { version: string };

function printJsonResult(result: {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; retryable: boolean; next_action?: NextAction } | null;
}) {
  if (result.ok) {
    console.log(JSON.stringify({
      ok: true,
      data: result.data ?? {},
      error: null,
    }, null, 2));
    return;
  }

  console.error(JSON.stringify({
    ok: false,
    error: result.error ?? {
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      retryable: false,
      next_action: stopNextAction(
        'The CLI hit an unknown top-level error and cannot infer a safe follow-up command.',
        'A human needs to inspect the error instead of having the agent guess from the command surface.',
      ),
    },
  }, null, 2));
}

function printHelp() {
  console.log(`Superplan CLI

Usage:
  superplan <command>

Commands:
  Setup:
    install    Install Superplan globally on this machine
    init       Initialize the current repository for Superplan
    context    Create or inspect durable workspace context artifacts

  Authoring:
    change     Create tracked change scaffolding

  Execution:
    status     Show active, ready, review, blocked, and feedback-needed queues
    run        Start, resume, or continue tracked work
    task       Inspect or transition one tracked task

  Diagnostics:
    parse      Parse task contracts and return diagnostics
    validate   Validate tasks.md graph and task-contract consistency
    sync       Reconcile repo state after task-file edits or runtime drift
    doctor     Validate install and overlay health
    visibility Inspect run visibility and health evidence
    overlay    Overlay companion operations

  Admin:
    update     Update an installed Superplan CLI and refresh skills
    remove     Remove Superplan installation or state

Options:
  -v, --version  Show CLI version
  --quiet     Suppress prompts and human-friendly logs
  --json      Output JSON for agents`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const json = args.includes('--json');
  const quiet = args.includes('--quiet');
  const showHelp = args.includes('--help') || command === 'help';
  const showVersion = args.includes('-v') || args.includes('--version');

  if (showVersion) {
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          version,
        },
        error: null,
      });
    } else {
      console.log(version);
    }
    return;
  }

  if (command === 'task' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getTaskCommandHelpMessage({});
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === 'overlay' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getOverlayCommandHelpMessage({});
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === 'change' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getChangeCommandHelpMessage({});
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === 'context' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getContextCommandHelpMessage({});
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === 'visibility' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getVisibilityCommandHelpMessage({});
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === 'remove' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getRemoveCommandHelpMessage();
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === 'install' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getInstallCommandHelpMessage();
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === 'init' && (args.includes('--help') || args[1] === 'help')) {
    const helpText = getInitCommandHelpMessage();
    if (json || quiet) {
      printJsonResult({
        ok: true,
        data: {
          help: helpText,
        },
        error: null,
      });
    } else {
      console.log(helpText);
    }
    return;
  }

  if (command === undefined || command === '--json' || command === '--quiet' || showHelp) {
    if (json || quiet) {
      printJsonResult({
        ok: false,
        error: {
          code: 'NO_COMMAND',
          message: 'No command provided',
          retryable: false,
          next_action: stopNextAction(
            'No command was provided. Choose one top-level command intentionally for the current workflow phase.',
            'The CLI should not guess a top-level intent when no command was supplied.',
          ),
        },
      });
      process.exitCode = 1;
      return;
    }

    printHelp();
    return;
  }

  if (!(command in router)) {
    printJsonResult({
      ok: false,
      error: {
        code: 'UNKNOWN_COMMAND',
        message: `Unknown command: ${command}`,
        retryable: false,
        next_action: stopNextAction(
          `Top-level command "${command}" does not exist. Choose a supported top-level command intentionally.`,
          'Unknown top-level commands should terminate instead of sending the agent into menu exploration.',
        ),
      },
    });
    process.exitCode = 1;
    return;
  }

  await routeCommand(args);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
