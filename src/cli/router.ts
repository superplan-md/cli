import { change } from "./commands/change";
import { context } from "./commands/context";
import { doctor } from "./commands/doctor";
import { parse } from "./commands/parse";
import { init } from "./commands/init";
import { task } from "./commands/task";
import { removeCli } from "./commands/remove";
import { run } from "./commands/run";
import { sync } from "./commands/sync";
import { status } from "./commands/status";
import { overlay } from "./commands/overlay";
import { update } from "./commands/update";
import { validate } from "./commands/validate";
import { visibility } from "./commands/visibility";

type CommandOptions = {
  json: boolean;
  quiet: boolean;
  yes?: boolean;
  scope?: string;
};

type CommandResult = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; retryable: boolean };
};

type CommandHandler = (
  args: string[],
  options: CommandOptions,
) => Promise<CommandResult>;

function printHumanSuccess(command: string, result: CommandResult): boolean {
  if (command === "init") {
    console.log("Superplan init completed successfully.");
    return true;
  }

  return false;
}

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
      code: "UNKNOWN_ERROR",
      message: "An unknown error occurred",
      retryable: false,
    },
  };
}

export const router: Record<string, CommandHandler> = {
  change: async (args) => change(args),
  context: async (args) => context(args),
  init: async (_args, options) => init({
    json: options.json,
    quiet: options.quiet,
    yes: options.yes,
    scope: options.scope === 'local' || options.scope === 'global' || options.scope === 'both' || options.scope === 'skip'
      ? options.scope
      : undefined,
  }),
  remove: async (args, options) => removeCli(args, {
    json: options.json,
    quiet: options.quiet,
    yes: options.yes,
    scope: options.scope === 'local' || options.scope === 'global' || options.scope === 'skip'
      ? options.scope
      : undefined,
  }),
  doctor: async (args) => doctor(args),
  parse: async (args, options) => parse(args, options),
  validate: async (args) => validate(args),
  run: async (args) => run(args),
  sync: async () => sync(),
  status: async () => status(),
  task: async (args) => task(args),
  overlay: async (args) => overlay(args),
  update: async (_args, options) => update(options),
  visibility: async (args) => visibility(args),
};

export async function routeCommand(args: string[]) {
  const command = args[0];
  const scopeIndex = args.indexOf("--scope");
  const options = {
    json: args.includes("--json"),
    quiet: args.includes("--quiet"),
    yes: args.includes("--yes"),
    scope: scopeIndex >= 0 ? args[scopeIndex + 1] : undefined,
  };
  const commandArgs = args.slice(1);
  const handler = command ? router[command as keyof typeof router] : undefined;

  if (handler) {
    const result = await handler(commandArgs, options);
    if (
      hasError(result) &&
      !options.json &&
      !options.quiet &&
      result.error.code === "INVALID_TASK_COMMAND"
    ) {
      console.error(result.error.message);
    } else if (
      result.ok &&
      !options.json &&
      !options.quiet &&
      printHumanSuccess(command, result)
    ) {
      // Human-friendly success output handled above.
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
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: {
            code: "UNKNOWN_COMMAND",
            message: `Unknown command: ${command}`,
            retryable: false,
          },
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}
