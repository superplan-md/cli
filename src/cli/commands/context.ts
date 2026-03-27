import * as path from 'path';
import * as fs from 'fs/promises';
import { resolveWorkspaceRoot } from '../workspace-root';
import { ensureWorkspaceArtifacts, getWorkspaceArtifactPaths } from '../workspace-artifacts';
import { commandNextAction, type NextAction } from '../next-action';

export type ContextResult =
  | {
      ok: true;
      data: {
        action: 'bootstrap' | 'status';
        root: string;
        created?: string[];
        missing?: string[];
        next_action: NextAction;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

function getPositionalArgs(args: string[]): string[] {
  const positionalArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json' || arg === '--quiet' || arg === '--stdin') {
      continue;
    }

    if (arg === '--content' || arg === '--file' || arg === '--kind') {
      index += 1;
      continue;
    }

    positionalArgs.push(arg);
  }

  return positionalArgs;
}

function toRelative(cwd: string, targetPath: string): string {
  return path.relative(cwd, targetPath) || '.';
}

async function appendContextDocToIndex(indexPath: string, docSlug: string): Promise<void> {
  const linkTarget = `./${docSlug}.md`;
  const entry = `- [${docSlug}](${linkTarget})`;
  const currentContent = await fs.readFile(indexPath, 'utf-8').catch(() => '');

  if (currentContent.includes(linkTarget) || currentContent.includes(entry)) {
    return;
  }

  const nextContent = currentContent.trimEnd()
    ? `${currentContent.trimEnd()}\n${entry}\n`
    : `${entry}\n`;
  await fs.writeFile(indexPath, nextContent, 'utf-8');
}

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

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

async function readStdin(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: string[] = [];
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', chunk => {
      chunks.push(String(chunk));
    });
    process.stdin.on('end', () => {
      resolve(chunks.join(''));
    });
    process.stdin.on('error', reject);
    process.stdin.resume();
  });
}

function normalizeDocSlug(input: string): string | null {
  const normalized = input.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\.md$/i, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) {
    return null;
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0 || !segments.every(segment => /^[A-Za-z0-9][A-Za-z0-9-_]*$/.test(segment))) {
    return null;
  }

  return segments.join('/');
}

async function readContentInput(args: string[], label: string): Promise<{ content?: string; error?: ContextResult }> {
  const inlineContent = getOptionValue(args, '--content');
  const filePath = getOptionValue(args, '--file');
  const useStdin = hasFlag(args, '--stdin');
  const sources = [inlineContent !== undefined, filePath !== undefined, useStdin].filter(Boolean).length;

  if (sources > 1) {
    return {
      error: {
        ok: false,
        error: {
          code: 'CONTEXT_CONTENT_INPUT_CONFLICT',
          message: `Provide ${label} using exactly one of --content, --file <path>, or --stdin.`,
          retryable: false,
        },
      },
    };
  }

  if (sources === 0) {
    return {
      error: {
        ok: false,
        error: {
          code: 'CONTEXT_CONTENT_INPUT_REQUIRED',
          message: `Provide ${label} using --content, --file <path>, or --stdin.`,
          retryable: false,
        },
      },
    };
  }

  if (inlineContent !== undefined) {
    return { content: inlineContent };
  }

  if (filePath !== undefined) {
    const resolvedFilePath = path.resolve(process.cwd(), filePath);
    try {
      return { content: await fs.readFile(resolvedFilePath, 'utf-8') };
    } catch {
      return {
        error: {
          ok: false,
          error: {
            code: 'CONTEXT_CONTENT_FILE_READ_FAILED',
            message: `Could not read content from ${toRelative(process.cwd(), resolvedFilePath)}.`,
            retryable: false,
          },
        },
      };
    }
  }

  try {
    const content = await readStdin();
    if (!content.trim()) {
      return {
        error: {
          ok: false,
          error: {
            code: 'CONTEXT_CONTENT_STDIN_EMPTY',
            message: `${label} stdin payload was empty.`,
            retryable: false,
          },
        },
      };
    }

    return { content };
  } catch {
    return {
      error: {
        ok: false,
        error: {
          code: 'CONTEXT_CONTENT_STDIN_READ_FAILED',
          message: `Could not read ${label} from stdin.`,
          retryable: false,
        },
      },
    };
  }
}

export function getContextCommandHelpMessage(options: { subcommand?: string } = {}): string {
  const intro = options.subcommand
    ? `Unknown context subcommand: ${options.subcommand}`
    : 'Superplan context command requires a subcommand.';

  return [
    intro,
    '',
    'Context commands:',
    '  bootstrap                          Create missing durable workspace context artifacts',
    '  status                             Report missing durable workspace context artifacts',
    '  doc set <doc-slug>                 Write a context document through the CLI',
    '  log add --kind <decision|gotcha>   Append a workspace log entry through the CLI',
    '',
    'Examples:',
    '  superplan context bootstrap --json',
    '  superplan context status --json',
    '  superplan context doc set architecture/auth --file auth-context.md --json',
    '  superplan context log add --kind decision --content "Choose change-scoped plans" --json',
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
  ];
}

async function writeContextDoc(args: string[], docSlug: string, superplanRoot: string, cwd: string): Promise<ContextResult> {
  const normalizedDocSlug = normalizeDocSlug(docSlug);
  if (!normalizedDocSlug) {
    return {
      ok: false,
      error: {
        code: 'INVALID_CONTEXT_DOC_SLUG',
        message: 'Context docs require a valid <doc-slug> using letters, numbers, hyphens, underscores, and optional nested paths.',
        retryable: false,
      },
    };
  }

  const contentResult = await readContentInput(args, 'context document content');
  if (contentResult.error) {
    return contentResult.error;
  }

  const paths = getWorkspaceArtifactPaths(superplanRoot);
  await ensureWorkspaceArtifacts(superplanRoot);
  const docPath = path.join(paths.contextDir, `${normalizedDocSlug}.md`);
  await fs.mkdir(path.dirname(docPath), { recursive: true });
  await fs.writeFile(docPath, `${contentResult.content!.trimEnd()}\n`, 'utf-8');
  await appendContextDocToIndex(paths.contextIndexPath, normalizedDocSlug);

  return {
    ok: true,
    data: {
      action: 'bootstrap',
      root: toRelative(cwd, superplanRoot),
      created: [toRelative(cwd, docPath)],
      next_action: commandNextAction(
        'superplan status --json',
        'The context document is now written through the CLI; continue from the tracked frontier.',
      ),
    },
  };
}

async function appendContextLog(args: string[], superplanRoot: string, cwd: string): Promise<ContextResult> {
  const kind = getOptionValue(args, '--kind');
  if (kind !== 'decision' && kind !== 'gotcha') {
    return {
      ok: false,
      error: {
        code: 'INVALID_CONTEXT_LOG_KIND',
        message: 'Context log writes require --kind decision or --kind gotcha.',
        retryable: false,
      },
    };
  }

  const contentResult = await readContentInput(args, `${kind} log entry`);
  if (contentResult.error) {
    return contentResult.error;
  }

  const paths = getWorkspaceArtifactPaths(superplanRoot);
  await ensureWorkspaceArtifacts(superplanRoot);
  const logPath = kind === 'decision' ? paths.decisionsPath : paths.gotchasPath;
  const normalizedEntry = contentResult.content!
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join(' ');
  const existingContent = await fs.readFile(logPath, 'utf-8');
  const separator = existingContent.endsWith('\n') ? '' : '\n';
  await fs.writeFile(logPath, `${existingContent}${separator}- ${normalizedEntry}\n`, 'utf-8');

  return {
    ok: true,
    data: {
      action: 'bootstrap',
      root: toRelative(cwd, superplanRoot),
      created: [toRelative(cwd, logPath)],
      next_action: commandNextAction(
        'superplan status --json',
        'The workspace log entry is now written through the CLI; continue from the tracked frontier.',
      ),
    },
  };
}

export async function context(args: string[] = []): Promise<ContextResult> {
  const positionalArgs = getPositionalArgs(args);
  const subcommand = positionalArgs[0];
  const action = positionalArgs[1];
  const subject = positionalArgs[2];
  const workspaceRoot = resolveWorkspaceRoot(process.cwd());
  const superplanRoot = path.join(workspaceRoot, '.superplan');
  const cwd = process.cwd();

  if (subcommand === 'doc' && action === 'set') {
    if (!subject) {
      return invalidContextCommand('doc set');
    }

    return await writeContextDoc(args, subject, superplanRoot, cwd);
  }

  if (subcommand === 'log' && action === 'add') {
    return await appendContextLog(args, superplanRoot, cwd);
  }

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
        next_action: commandNextAction(
          'superplan change new <change-slug> --json',
          'Durable workspace context now exists, so the next control-plane step is creating tracked work.',
        ),
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
      next_action: missing.length > 0
        ? commandNextAction(
          'superplan context bootstrap --json',
          'Context entrypoints are missing, so bootstrap them before relying on Superplan memory.',
        )
        : commandNextAction(
          'superplan status --json',
          'Context entrypoints are already present, so continue with the runtime loop.',
        ),
    },
  };
}
