import * as fs from 'fs/promises';
import * as path from 'path';
import { loadChangeGraph, type ChangeGraph } from '../graph';
import { getDefaultChangesRoots, parse, type ParseDiagnostic, type ParsedTask } from './parse';
import { resolveWorkspaceRoot } from '../workspace-root';
import { collectWorkspaceHealthIssues, workspaceIssuesToDiagnostics } from '../workspace-health';
import { commandNextAction, stopNextAction, type NextAction } from '../next-action';
import { applyAutoFix, type AutoFixResult } from '../graph-autofix';

interface ValidateChangeResult {
  change_id: string;
  valid: boolean;
  graph: ChangeGraph | null;
  tasks: ParsedTask[];
  diagnostics: ParseDiagnostic[];
  auto_fix?: AutoFixResult;
}

export type ValidateResult =
  | {
      ok: true;
      data: {
        valid: boolean;
        changes: ValidateChangeResult[];
        diagnostics: ParseDiagnostic[];
        next_action: NextAction;
      };
    }
  | { ok: false; error: { code: string; message: string; retryable: boolean } };

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveChangeDirs(targetPath: string): Promise<string[]> {
  const stats = await fs.stat(targetPath);

  if (stats.isFile()) {
    if (path.basename(targetPath) === 'tasks.md') {
      return [path.dirname(targetPath)];
    }

    return [];
  }

  if (await pathExists(path.join(targetPath, 'tasks'))) {
    return [targetPath];
  }

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const changeDirs: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const changeDir = path.join(targetPath, entry.name);
    if (await pathExists(path.join(changeDir, 'tasks')) || await pathExists(path.join(changeDir, 'tasks.md'))) {
      changeDirs.push(changeDir);
    }
  }

  return changeDirs.sort((left, right) => left.localeCompare(right));
}

function dedupeDiagnostics(diagnostics: ParseDiagnostic[]): ParseDiagnostic[] {
  const seen = new Set<string>();
  const deduped: ParseDiagnostic[] = [];

  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.code}:${diagnostic.task_id ?? ''}:${diagnostic.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(diagnostic);
  }

  return deduped;
}

export async function validate(args: string[] = []): Promise<ValidateResult> {
  const shouldFix = args.includes('--fix');
  const positionalArgs = args.filter(arg => arg !== '--json' && arg !== '--quiet' && arg !== '--fix');
  const cwd = process.cwd();
  const input = positionalArgs[0];
  let resolvedTargetPath: string | null = null;

  if (input) {
    const explicitPath = path.resolve(cwd, input);
    if (await pathExists(explicitPath)) {
      resolvedTargetPath = explicitPath;
    } else {
      for (const changesRoot of getDefaultChangesRoots(cwd)) {
        const candidatePath = path.join(changesRoot, input);
        if (await pathExists(candidatePath)) {
          resolvedTargetPath = candidatePath;
          break;
        }
      }
    }
  } else {
    const existingChangesRoots = await Promise.all(
      getDefaultChangesRoots(cwd).map(async changesRoot => (await pathExists(changesRoot) ? changesRoot : null)),
    );
    resolvedTargetPath = existingChangesRoots.find((changesRoot): changesRoot is string => changesRoot !== null) ?? null;
  }

  if (!resolvedTargetPath) {
    return {
      ok: true,
      data: {
        valid: false,
        changes: [],
        diagnostics: [
          {
            code: 'CHANGES_DIR_MISSING',
            message: 'No Superplan changes directory found. Run superplan init.',
          },
        ],
        next_action: commandNextAction(
          'superplan init --yes --json',
          'Validation cannot run until Superplan has created a tracked changes root.',
        ),
      },
    };
  }

  const changeDirs = await resolveChangeDirs(resolvedTargetPath);
  const changes: ValidateChangeResult[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const includeWorkspaceHealth = !input;
  const workspaceHealthDiagnostics = includeWorkspaceHealth
    ? dedupeDiagnostics(workspaceIssuesToDiagnostics(await collectWorkspaceHealthIssues(workspaceRoot)))
    : [];

  for (const changeDir of changeDirs) {
    const graphPath = path.join(changeDir, 'tasks.md');
    let autoFixResult: AutoFixResult | undefined;

    // Apply auto-fix if requested
    if (shouldFix && await pathExists(graphPath)) {
      autoFixResult = await applyAutoFix(graphPath);
    }

    const graphResult = await loadChangeGraph(changeDir);
    const parsedResult = await parse([changeDir], { json: true });
    if (!parsedResult.ok) {
      return parsedResult;
    }

    const changeId = graphResult.graph?.change_id ?? path.basename(changeDir);
    const changeDiagnostics = dedupeDiagnostics([
      ...graphResult.diagnostics,
      ...parsedResult.data.diagnostics,
    ]);

    diagnostics.push(...changeDiagnostics);
    changes.push({
      change_id: changeId,
      valid: changeDiagnostics.length === 0,
      graph: graphResult.graph ?? null,
      tasks: parsedResult.data.tasks,
      diagnostics: changeDiagnostics,
      ...(autoFixResult ? { auto_fix: autoFixResult } : {}),
    });
  }

  const dedupedDiagnostics = dedupeDiagnostics(diagnostics);
  return {
    ok: true,
    data: {
      valid: dedupedDiagnostics.length === 0 && workspaceHealthDiagnostics.length === 0,
      changes,
      diagnostics: dedupeDiagnostics([...dedupedDiagnostics, ...workspaceHealthDiagnostics]),
      next_action: dedupedDiagnostics.length === 0 && workspaceHealthDiagnostics.length === 0
        ? commandNextAction(
          'superplan status --json',
          'Validation passed, so the next useful control-plane step is checking or continuing runnable work.',
        )
        : stopNextAction(
          'Fix the reported validation issues before using the runtime loop or scaffolding more task contracts.',
          'The graph or task contracts are inconsistent, so the workflow should not continue as if state were trustworthy.',
        ),
    },
  };
}
