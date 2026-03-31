import { change } from "./commands/change";
import { context } from "./commands/context";
import { doctor } from "./commands/doctor";
import { parse } from "./commands/parse";
import { init } from "./commands/init";
import { task } from "./commands/task";
import { quick } from "./commands/quick";
import { removeCli } from "./commands/remove";
import { uninstallCli } from "./commands/uninstall";
import { run } from "./commands/run";
import { sync } from "./commands/sync";
import { status } from "./commands/status";
import { overlay } from "./commands/overlay";
import { update } from "./commands/update";
import { validate } from "./commands/validate";
import { visibility } from "./commands/visibility";
import { worktree } from "./commands/worktree";
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
  global?: boolean;
  local?: boolean;
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

  if (command === "change" && data && typeof data.change_id === "string") {
    console.log(`Created change ${data.change_id}.`);
    if (data.next_action?.type === 'command' && data.next_action.command) {
      console.log(`Next: ${data.next_action.command}`);
    } else if (data.next_action?.type === 'stop' && data.next_action.outcome) {
      console.log(data.next_action.outcome);
    }
    return true;
  }

  if (command === "context" && data && Array.isArray(data.created)) {
    const created = data.created.length > 0 ? data.created.join(', ') : 'no files';
    console.log(`Updated context: ${created}.`);
    if (data.next_action?.type === 'command' && data.next_action.command) {
      console.log(`Next: ${data.next_action.command}`);
    }
    return true;
  }

  if (command === "status" && data && data.counts) {
    if (!data.active && data.counts.ready === 0 && data.counts.in_review === 0 && data.counts.blocked === 0 && data.counts.needs_feedback === 0) {
      console.log('No runnable tracked work.');
      return true;
    }

    if (data.active) {
      console.log(`Active: ${data.active}`);
    }
    console.log(`Ready: ${data.counts.ready}  In review: ${data.counts.in_review}  Blocked: ${data.counts.blocked}  Needs feedback: ${data.counts.needs_feedback}`);
    return true;
  }

  if (command === "run" && data) {
    if (data.action === 'idle') {
      console.log('No ready tasks available.');
      return true;
    }

    if (typeof data.task_id === 'string' && data.task && typeof data.task.title === 'string') {
      const action = typeof data.action === 'string' ? data.action[0].toUpperCase() + data.action.slice(1) : 'Activated';
      console.log(`${action} ${data.task_id}: ${data.task.title}`);
      return true;
    }
  }
  return false;
}

function printHumanError(error: { code: string; message: string; retryable: boolean; next_action?: NextAction }): void {
  console.error(error.message);

  if (!error.next_action) {
    return;
  }

  if (error.next_action.type === 'command' && error.next_action.command) {
    console.error(`Next: ${error.next_action.command}`);
    return;
  }

  if (error.next_action.type === 'stop' && error.next_action.outcome && error.next_action.outcome !== error.message) {
    console.error(`Next: ${error.next_action.outcome}`);
  }
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

  if (error.code === 'INVALID_WORKTREE_COMMAND') {
    return stopNextAction(
      'The worktree command is invalid. Use `superplan worktree ensure <change>`, `list`, `detach <change>`, or `prune`.',
      'Invalid worktree invocations should terminate with the exact supported commands.',
    );
  }

  if (error.code === 'INVALID_REMOVE_COMMAND') {
    return stopNextAction(
      'The remove command is invalid. Use `superplan remove --scope <local|global|skip> --yes --json` for automation.',
      'Invalid remove invocations should terminate with the exact supported non-interactive form.',
    );
  }

  if (error.code === 'INVALID_UNINSTALL_COMMAND') {
    return stopNextAction(
      'The uninstall command is invalid. Use `superplan uninstall --yes --json` for automation.',
      'Invalid uninstall invocations should terminate with the exact supported non-interactive form.',
    );
  }

  if (error.code === 'INVALID_INIT_COMMAND' || error.code === 'INTERACTIVE_REQUIRED') {
    return stopNextAction(
      'The init invocation is invalid for the current mode. Use `superplan init --yes --json` for automation.',
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
      'superplan init --yes --json',
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

  if (error.code === 'EXECUTION_ROOT_OCCUPIED') {
    return commandNextAction(
      'superplan worktree list --json',
      'The current checkout is occupied by another active change, so inspect or ensure an alternate execution root before proceeding.',
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
    global: options.global,
    local: options.local,
  }),
  quick: async (args) => quick(args),
  remove: async (args, options) => removeCli(args, {
    json: options.json,
    quiet: options.quiet,
    yes: options.yes,
    scope: options.scope === 'local' || options.scope === 'global' || options.scope === 'skip'
      ? options.scope
      : undefined,
  }),
  uninstall: async (args, options) => uninstallCli(args, {
    json: options.json,
    quiet: options.quiet,
    yes: options.yes,
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
  worktree: async (args) => worktree(args),
};

export async function routeCommand(args: string[]) {
  const command = args[0];
  const scopeIndex = args.indexOf("--scope");
  const options = {
    json: args.includes("--json"),
    quiet: args.includes("--quiet"),
    yes: args.includes("--yes"),
    global: args.includes("--global"),
    local: args.includes("--local"),
    scope: scopeIndex >= 0 ? args[scopeIndex + 1] : undefined,
  };
  const commandArgs = args.slice(1);
  const handler = command ? router[command as keyof typeof router] : undefined;

  if (handler) {
    const result = await handler(commandArgs, options);
    if (!result.ok && result.error) {
      result.error.next_action = inferErrorNextAction(command, result.error);
    }
    if (hasError(result) && !options.json && !options.quiet) {
      printHumanError(result.error);
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
    const unknownCommandError = {
      code: "UNKNOWN_COMMAND",
      message: `Unknown command: ${command}`,
      retryable: false,
      next_action: stopNextAction(
        `Top-level command "${command}" does not exist. Choose a supported top-level command intentionally.`,
        'Unknown top-level commands should terminate instead of sending the agent into menu exploration.',
      ),
    };
    if (!options.json && !options.quiet) {
      printHumanError(unknownCommandError);
    } else {
      console.error(
        JSON.stringify(
          {
            ok: false,
            error: unknownCommandError,
          },
          null,
          2,
        ),
      );
    }
    process.exitCode = 1;
  }
}
