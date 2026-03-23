import * as path from 'path';
import * as fs from 'fs/promises';
import { resolveWorkspaceRoot } from '../workspace-root';
import { ensureWorkspaceArtifacts, getWorkspaceArtifactPaths } from '../workspace-artifacts';

export type ContextResult =
  | {
      ok: true;
      data: {
        action: 'bootstrap' | 'status';
        root: string;
        created?: string[];
        missing?: string[];
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function getPositionalArgs(args: string[]): string[] {
  return args.filter(arg => arg !== '--json' && arg !== '--quiet');
}

function toRelative(cwd: string, targetPath: string): string {
  return path.relative(cwd, targetPath) || '.';
}

export function getContextCommandHelpMessage(options: { subcommand?: string } = {}): string {
  const intro = options.subcommand
    ? `Unknown context subcommand: ${options.subcommand}`
    : 'Superplan context command requires a subcommand.';

  return [
    intro,
    '',
    'Context commands:',
    '  bootstrap                  Create missing durable workspace context artifacts',
    '  status                     Report missing durable workspace context artifacts',
    '',
    'Examples:',
    '  superplan context bootstrap --json',
    '  superplan context status --json',
  ].join('\n');
}

function invalidContextCommand(subcommand?: string): ContextResult {
  return {
    ok: false,
    error: {
      code: 'INVALID_CONTEXT_COMMAND',
      message: getContextCommandHelpMessage({ subcommand }),
      retryable: true,
    },
  };
}

function getMissingContextArtifacts(superplanRoot: string): string[] {
  const paths = getWorkspaceArtifactPaths(superplanRoot);
  return [
    paths.contextReadmePath,
    paths.contextIndexPath,
    paths.decisionsPath,
    paths.gotchasPath,
    paths.planPath,
  ];
}

export async function context(args: string[] = []): Promise<ContextResult> {
  const positionalArgs = getPositionalArgs(args);
  const subcommand = positionalArgs[0];
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const superplanRoot = path.join(workspaceRoot, '.superplan');
  const cwd = process.cwd();

  if (subcommand !== 'bootstrap' && subcommand !== 'status') {
    return invalidContextCommand(subcommand);
  }

  const artifactPaths = getWorkspaceArtifactPaths(superplanRoot);
  const requiredPaths = getMissingContextArtifacts(superplanRoot);

  if (subcommand === 'bootstrap') {
    const createdPaths = await ensureWorkspaceArtifacts(superplanRoot);
    return {
      ok: true,
      data: {
        action: 'bootstrap',
        root: toRelative(cwd, superplanRoot),
        created: createdPaths.map(createdPath => toRelative(cwd, createdPath)),
      },
    };
  }

  const missing: string[] = [];
  for (const targetPath of requiredPaths) {
    try {
      await fs.access(targetPath);
    } catch {
      missing.push(toRelative(cwd, targetPath));
    }
  }

  return {
    ok: true,
    data: {
      action: 'status',
      root: toRelative(cwd, artifactPaths.superplanRoot),
      missing,
    },
  };
}
