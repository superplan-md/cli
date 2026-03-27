import { change } from "./commands/change";
import { context } from "./commands/context";
import { doctor } from "./commands/doctor";
import { parse } from "./commands/parse";
import { init } from "./commands/init";
import { install } from "./commands/install";
import { task } from "./commands/task";
import { removeCli } from "./commands/remove";
import { run } from "./commands/run";
import { sync } from "./commands/sync";
import { status } from "./commands/status";
import { overlay } from "./commands/overlay";
import { update } from "./commands/update";
import { validate } from "./commands/validate";
import { visibility } from "./commands/visibility";
import {
  commandNextAction,
  stopNextAction,
  type NextAction,
} from "./next-action";

type CommandOptions = {
  json: boolean;
  quiet: boolean;
  yes?: boolean;
  scope?: string;
};

type CommandResult = {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; retryable: boolean; next_action?: NextAction };
};

type CommandHandler = (
  args: string[],
  options: CommandOptions,
) => Promise<CommandResult>;

function printHumanSuccess(command: string, result: CommandResult): boolean {
  const data = result.data as any;
  if (data && typeof data.message === "string") {
    console.log(data.message);
    return true;
  }

  if (command === "init") {
    console.log("Superplan init completed successfully.");
    return true;
  }

  if (command === "install") {
    console.log("Superplan global installation successful.");
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
      next_action: stopNextAction(
        'The CLI hit an unknown routed-command error and cannot infer a safe follow-up command.',
        'A human needs to inspect the routed-command failure instead of having the agent guess.',
      ),
    },
  };
}

function inferErrorNextAction(command: string | undefined, error: { code: string; message: string; retryable: boolean; next_action?: NextAction }): NextAction | undefined {
  if (error.next_action) {
    return error.next_action;
  }

  if (error.code === 'INVALID_TASK_COMMAND') {
    return stopNextAction(
      'The task command is invalid. Use a phase namespace such as inspect, scaffold, review, runtime, or repair.',
      'Invalid task commands should terminate instead of sending the agent to browse help output.',
    );
  }

  if (error.code === 'INVALID_CHANGE_COMMAND') {
    return stopNextAction(
      'The change command is invalid. Use `superplan change new`, `superplan change plan set`, `superplan change spec set`, or `superplan change task add`.',
      'Invalid change invocations should terminate with one explicit surface description.',
    );
  }

  if (error.code === 'INVALID_CONTEXT_COMMAND') {
    return stopNextAction(
      'The context command is invalid. Use `superplan context bootstrap`, `superplan context status`, `superplan context doc set`, or `superplan context log add`.',
      'Invalid context invocations should terminate with the exact supported commands.',
    );
  }

  if (error.code === 'INVALID_OVERLAY_COMMAND') {
    return stopNextAction(
      'The overlay command is invalid. Use `overlay enable`, `disable`, `status`, `ensure`, or `hide`.',
      'Invalid overlay invocations should terminate with the exact supported commands.',
    );
  }

  if (error.code === 'INVALID_VISIBILITY_COMMAND') {
    return stopNextAction(
      'The visibility command is invalid. The supported action is `superplan visibility report --json`.',
      'Invalid visibility invocations should terminate with the exact supported command.',
    );
  }

  if (error.code === 'INVALID_REMOVE_COMMAND') {
    return stopNextAction(
      'The remove command is invalid. Use `superplan remove --scope <local|global|skip> --yes --json` for automation.',
      'Invalid remove invocations should terminate with the exact supported non-interactive form.',
    );
  }

  if (error.code === 'INVALID_INIT_COMMAND' || error.code === 'INTERACTIVE_REQUIRED') {
    return stopNextAction(
      'The init invocation is invalid for the current mode. Use `superplan init --scope <local|global|both|skip> --yes --json` for automation.',
      'Invalid init invocations should terminate with the exact supported non-interactive form.',
    );
  }

  if (error.code === 'INVALID_RUN_COMMAND') {
    return commandNextAction(
      'superplan run --json',
      'Run only supports zero or one explicit task id.',
    );
  }

  if (error.code === 'INIT_REQUIRED') {
    return commandNextAction(
      'superplan init --yes --json',
      'The requested command depends on repo-local Superplan state that does not exist yet.',
    );
  }

  if (error.code === 'INSTALL_REQUIRED') {
    return commandNextAction(
      'superplan install --quiet --json',
      'The requested command depends on machine-level Superplan state that does not exist yet.',
    );
  }

  if (error.code === 'TASK_IN_REVIEW' || error.code === 'TASK_ALREADY_COMPLETED' || error.code === 'TASK_NOT_IN_REVIEW' || error.code === 'TASK_NOT_REVIEWABLE') {
    return stopNextAction(
      'The task is in a review-only lifecycle branch. Use `superplan task review approve <task_id> --json` or `superplan task review reopen <task_id> --reason "..." --json` intentionally.',
      'The task is currently in a review-only lifecycle branch.',
    );
  }

  if (error.code === 'INVALID_STATE_MULTIPLE_IN_PROGRESS' || error.code === 'RUNTIME_CONFLICT_AMBIGUOUS_LEGACY_TASK_ID') {
    return commandNextAction(
      'superplan task repair fix --json',
      'Runtime state is inconsistent, so the deterministic next step is repair rather than more lifecycle transitions.',
    );
  }

  if (error.code === 'TASK_NOT_IN_PROGRESS' || error.code === 'TASK_NOT_STARTED' || error.code === 'TASK_NOT_READY') {
    return commandNextAction(
      'superplan status --json',
      'The requested transition does not match the current runtime state.',
    );
  }

  if (error.code === 'TASK_NOT_COMPLETE') {
    return stopNextAction(
      'The task is not complete yet. Finish the acceptance criteria before moving it into or through review.',
      'The task is not actually complete yet.',
    );
  }

  if (error.code === 'TASK_NOT_IN_GRAPH') {
    return stopNextAction(
      'The task id is not declared in the change graph. Add it to tasks.md, validate the graph, then scaffold it again.',
      'Task scaffolding only works for graph-declared task ids.',
    );
  }

  if (error.code === 'TASK_NOT_FOUND') {
    return commandNextAction(
      'superplan status --json',
      'The requested task id does not exist in the current workspace state.',
    );
  }

  if (error.code === 'USER_ABORTED') {
    return stopNextAction(
      'The command was aborted intentionally by the user.',
      'The automation loop should stop rather than infer a replacement action.',
    );
  }

  if (error.code === 'CHANGE_EXISTS') {
    return stopNextAction(
      'That change slug already exists. Choose a different change slug or continue the existing change intentionally.',
      'Creating the same change again should not trigger an automatic fallback command.',
    );
  }

  if (error.code === 'VISIBILITY_REPORT_UNAVAILABLE') {
    return commandNextAction(
      'superplan status --json',
      'No visibility report exists yet; return to the live frontier instead.',
    );
  }

  if (error.code === 'TASK_BATCH_INPUT_REQUIRED' || error.code === 'TASK_BATCH_INPUT_CONFLICT') {
    return stopNextAction(
      'Task batch needs exactly one JSON input source. Use `--stdin` for automation or `--file <path>`, but not both.',
      'Task scaffolding should stop until its input source is explicit.',
    );
  }

  if (error.code === 'INIT_VERIFICATION_FAILED') {
    return commandNextAction(
      'superplan doctor --json',
      'Init verification failed, so inspect install and workspace health before continuing.',
    );
  }

  return stopNextAction(
    `No deterministic recovery rule matched error code ${error.code}.`,
    'The automation loop should stop rather than guess a fallback command.',
  );
}

export const router: Record<string, CommandHandler> = {
  change: async (args) => change(args),
  context: async (args) => context(args),
  init: async (_args, options) => init({
    json: options.json,
    quiet: options.quiet,
    yes: options.yes,
  }),
  install: async (_args, options) => install({
    json: options.json,
    quiet: options.quiet,
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
    if (!result.ok && result.error) {
      result.error.next_action = inferErrorNextAction(command, result.error);
    }
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
