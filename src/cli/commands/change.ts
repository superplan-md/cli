import * as fs from 'fs/promises';
import * as path from 'path';
import {
  buildChangeTasksIndex,
  formatTitleFromSlug,
  getChangePaths,
  isValidChangeSlug,
  pathExists,
} from './scaffold';

export type ChangeResult =
  | {
      ok: true;
      data: {
        change_id: string;
        root: string;
        files: string[];
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

const CHANGE_SUBCOMMANDS = new Set([
  'new',
]);

function getOptionValue(args: string[], optionName: string): string | undefined {
  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) {
    return undefined;
  }

  const optionValue = args[optionIndex + 1];
  if (!optionValue || optionValue.startsWith('--')) {
    return undefined;
  }

  return optionValue;
}

function getPositionalArgs(args: string[]): string[] {
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json' || arg === '--quiet') {
      continue;
    }

    if (arg === '--title') {
      index += 1;
      continue;
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

export function getChangeCommandHelpMessage(options: {
  subcommand?: string;
  requiresSlug?: boolean;
}): string {
  const { subcommand, requiresSlug } = options;

  let intro = 'Superplan change command requires a subcommand.';
  if (subcommand && !requiresSlug) {
    intro = `Unknown change subcommand: ${subcommand}`;
  } else if (subcommand && requiresSlug) {
    intro = `Change command "${subcommand}" requires a <slug>.`;
  }

  return [
    intro,
    '',
    'Change commands:',
    '  new <slug>                  Create a new tracked change',
    '',
    'Examples:',
    '  superplan change new improve-task-authoring',
    '  superplan change new improve-task-authoring --title "Improve Task Authoring"',
  ].join('\n');
}

function getInvalidChangeCommandError(options: {
  subcommand?: string;
  requiresSlug?: boolean;
}): ChangeResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_CHANGE_COMMAND',
      message: getChangeCommandHelpMessage(options),
      retryable: true,
    },
  };
}

async function createChange(changeSlug: string, title?: string): Promise<ChangeResult> {
  if (!isValidChangeSlug(changeSlug)) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CHANGE_SLUG',
        message: 'Change slug must use lowercase letters, numbers, and hyphens',
        retryable: false,
      },
    };
  }

  const changePaths = getChangePaths(changeSlug);
  if (!await pathExists(changePaths.changesRoot)) {
    return {
      ok: false,
      error: {
        code: 'INIT_REQUIRED',
        message: 'Run superplan init before creating a change',
        retryable: true,
      },
    };
  }

  if (await pathExists(changePaths.changeRoot)) {
    return {
      ok: false,
      error: {
        code: 'CHANGE_EXISTS',
        message: 'Change already exists',
        retryable: false,
      },
    };
  }

  await fs.mkdir(changePaths.tasksDir, { recursive: true });
  await fs.writeFile(
    changePaths.tasksIndexPath,
    buildChangeTasksIndex(changeSlug, title?.trim() || formatTitleFromSlug(changeSlug)),
    'utf-8',
  );

  return {
    ok: true,
    data: {
      change_id: changeSlug,
      root: path.relative(process.cwd(), changePaths.changeRoot) || changePaths.changeRoot,
      files: [
        path.relative(process.cwd(), changePaths.tasksIndexPath) || changePaths.tasksIndexPath,
        path.relative(process.cwd(), changePaths.tasksDir) || changePaths.tasksDir,
      ],
    },
  };
}

export async function change(args: string[]): Promise<ChangeResult> {
  const positionalArgs = getPositionalArgs(args);
  const subcommand = positionalArgs[0];
  const changeSlug = positionalArgs[1];
  const title = getOptionValue(args, '--title');

  if (!subcommand || !CHANGE_SUBCOMMANDS.has(subcommand)) {
    return getInvalidChangeCommandError({ subcommand });
  }

  if (subcommand === 'new') {
    if (!changeSlug) {
      return getInvalidChangeCommandError({
        subcommand,
        requiresSlug: true,
      });
    }

    return createChange(changeSlug, title);
  }

  return getInvalidChangeCommandError({ subcommand });
}
