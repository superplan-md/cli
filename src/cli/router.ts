import { setup } from './commands/setup';
import { doctor } from './commands/doctor';
import { parse } from './commands/parse';
import { init } from './commands/init';
import { task } from './commands/task';
import { purge, remove } from './commands/remove';
import { run } from './commands/run';
import { status } from './commands/status';
import { overlay } from './commands/overlay';

type CommandOptions = {
  json: boolean;
  quiet: boolean;
};

type CommandResult = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; retryable: boolean };
};

type CommandHandler = (args: string[], options: CommandOptions) => Promise<CommandResult>;

function hasError(result: CommandResult): result is CommandResult & {
  error: { code: string; message: string; retryable: boolean };
} {
  return !result.ok && Boolean(result.error);
}

function normalizeCliResult(result: CommandResult) {
  if (result.ok) {
    return {
      ok: true,
      data: result.data ?? {},
      error: null,
    };
  }

  return {
    ok: false,
    error: result.error ?? {
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      retryable: false,
    },
  };
}

export const router: Record<string, CommandHandler> = {
  init: async (_args, options) => init(options),
  setup: async (_args, options) => setup(options),
  remove: async (_args, options) => remove(options),
  purge: async (_args, options) => purge(options),
  doctor: async (args) => doctor(args),
  parse: async (args, options) => parse(args, options),
  run: async () => run(),
  status: async () => status(),
  task: async (args) => task(args),
  overlay: async (args) => overlay(args),
};

export async function routeCommand(args: string[]) {
  const command = args[0];
  const options = {
    json: args.includes('--json'),
    quiet: args.includes('--quiet'),
  };
  const commandArgs = args.slice(1);
  const handler = command ? router[command as keyof typeof router] : undefined;

  if (handler) {
    const result = await handler(commandArgs, options);
    if (hasError(result) && !options.json && !options.quiet && result.error.code === 'INVALID_TASK_COMMAND') {
      console.error(result.error.message);
    } else {
      const normalizedResult = normalizeCliResult(result);
      const serializedResult = JSON.stringify(normalizedResult, null, 2);
      if (result.ok) {
        console.log(serializedResult);
      } else {
        console.error(serializedResult);
      }
    }

    if (!result.ok) {
      process.exitCode = 1;
    }
  } else {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: "UNKNOWN_COMMAND",
        message: `Unknown command: ${command}`,
        retryable: false
      }
    }, null, 2));
    process.exitCode = 1;
  }
}
