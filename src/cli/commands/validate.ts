import * as fs from 'fs/promises';
import * as path from 'path';
import { loadChangeGraph, type ChangeGraph } from '../graph';
import { parse, type ParseDiagnostic, type ParsedTask } from './parse';
import { resolveWorkspaceRoot } from '../workspace-root';
import { collectWorkspaceHealthIssues, workspaceIssuesToDiagnostics } from '../workspace-health';

interface ValidateChangeResult {
  change_id: string;
  valid: boolean;
  graph: ChangeGraph | null;
  tasks: ParsedTask[];
  diagnostics: ParseDiagnostic[];
}

export type ValidateResult =
  | {
      ok: true;
      data: {
        valid: boolean;
        changes: ValidateChangeResult[];
        diagnostics: ParseDiagnostic[];
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
  const positionalArgs = args.filter(arg => arg !== '--json' && arg !== '--quiet');
  const cwd = process.cwd();
  const changesRoot = path.join(resolveWorkspaceRoot(cwd), '.superplan', 'changes');
  const input = positionalArgs[0];
  const resolvedTargetPath = input
    ? (await pathExists(path.resolve(cwd, input))
      ? path.resolve(cwd, input)
      : path.join(changesRoot, input))
    : changesRoot;

  if (!await pathExists(resolvedTargetPath)) {
    return {
      ok: true,
      data: {
        valid: false,
        changes: [],
        diagnostics: [
          {
            code: 'CHANGES_DIR_MISSING',
            message: 'No .superplan/changes directory found. Run superplan init.',
          },
        ],
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
    });
  }

  const dedupedDiagnostics = dedupeDiagnostics(diagnostics);
  return {
    ok: true,
    data: {
      valid: dedupedDiagnostics.length === 0 && workspaceHealthDiagnostics.length === 0,
      changes,
      diagnostics: dedupeDiagnostics([...dedupedDiagnostics, ...workspaceHealthDiagnostics]),
    },
  };
}
