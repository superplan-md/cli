import { detectWorkflowSurfaces } from './workflow-surfaces';

export interface TaskRecipeConfig {
  run_commands: string[];
  verify_commands: string[];
  evidence: string[];
  notes: string[];
  scope_paths: string[];
}

export interface ResolvedTaskRecipe extends TaskRecipeConfig {
  source: 'task' | 'repo_inferred' | 'mixed' | 'none';
}

export interface TaskRecipeResolutionInput {
  title?: string;
  description: string;
  acceptance_criteria: Array<{ text: string }>;
  task_recipe?: TaskRecipeConfig;
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function parseRecipeBullet(lines: string[] | undefined, section: 'execution' | 'verification'): TaskRecipeConfig {
  if (!lines) {
    return {
      run_commands: [],
      verify_commands: [],
      evidence: [],
      notes: [],
      scope_paths: [],
    };
  }

  const recipe: TaskRecipeConfig = {
    run_commands: [],
    verify_commands: [],
    evidence: [],
    notes: [],
    scope_paths: [],
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('- ')) {
      continue;
    }

    const bulletContent = line.slice(2).trim();
    if (!bulletContent) {
      continue;
    }

    const keyedMatch = /^([a-zA-Z][a-zA-Z\s-]*):\s*(.+)$/.exec(bulletContent);
    if (!keyedMatch) {
      recipe.notes.push(bulletContent);
      continue;
    }

    const key = normalizeKey(keyedMatch[1]);
    const value = keyedMatch[2].trim();
    if (!value) {
      continue;
    }

    if (section === 'execution') {
      if (key === 'run' || key === 'start' || key === 'command') {
        recipe.run_commands.push(value);
        continue;
      }

      if (key === 'scope' || key === 'scopes' || key === 'path' || key === 'paths' || key === 'file' || key === 'files') {
        recipe.scope_paths.push(value);
        continue;
      }
    } else {
      if (key === 'verify' || key === 'check' || key === 'command') {
        recipe.verify_commands.push(value);
        continue;
      }

      if (key === 'evidence' || key === 'proof') {
        recipe.evidence.push(value);
        continue;
      }
    }

    recipe.notes.push(value);
  }

  recipe.run_commands = unique(recipe.run_commands);
  recipe.verify_commands = unique(recipe.verify_commands);
  recipe.evidence = unique(recipe.evidence);
  recipe.notes = unique(recipe.notes);
  recipe.scope_paths = unique(recipe.scope_paths);
  return recipe;
}

export function parseTaskRecipeSections(sections: Record<string, string[]>): TaskRecipeConfig {
  const execution = parseRecipeBullet(sections.Execution, 'execution');
  const verification = parseRecipeBullet(sections.Verification, 'verification');

  return {
    run_commands: execution.run_commands,
    verify_commands: verification.verify_commands,
    evidence: verification.evidence,
    notes: unique([
      ...execution.notes,
      ...verification.notes,
    ]),
    scope_paths: execution.scope_paths,
  };
}

function scriptToCommand(scriptName: string): string {
  if (scriptName === 'test') {
    return 'npm test';
  }

  if (scriptName === 'start') {
    return 'npm start';
  }

  return `npm run ${scriptName}`;
}

async function inferRecipeFromRepo(
  input: TaskRecipeResolutionInput,
  cwd: string,
): Promise<TaskRecipeConfig> {
  const workflowSurfaces = await detectWorkflowSurfaces(cwd);
  const scripts = workflowSurfaces.package_scripts.scripts;
  const text = [
    input.title ?? '',
    input.description,
    ...input.acceptance_criteria.map(criterion => criterion.text),
  ].join(' ').toLowerCase();

  const runCommands: string[] = [];
  const verifyCommands: string[] = [];
  const notes: string[] = [];

  if (
    scripts.start
    && /(server|serve|dashboard|admin|login|preview|http|ws|websocket|ui|app)\b/.test(text)
  ) {
    runCommands.push(scriptToCommand('start'));
  }

  if (scripts['test:server'] && /(server|http|ws|websocket)\b/.test(text)) {
    verifyCommands.push(scriptToCommand('test:server'));
  }

  if (scripts['visibility:examples'] && /\bvisibility\b/.test(text)) {
    verifyCommands.push(scriptToCommand('visibility:examples'));
  }

  if (scripts['overlay:bundle'] && /\boverlay\b/.test(text)) {
    verifyCommands.push(scriptToCommand('overlay:bundle'));
  }

  if (scripts.build) {
    verifyCommands.push(scriptToCommand('build'));
  }

  if (scripts.test) {
    verifyCommands.push(scriptToCommand('test'));
  }

  verifyCommands.push(...workflowSurfaces.package_scripts.verify_commands);

  if (workflowSurfaces.verification_surfaces.length > 0) {
    notes.push(
      `Repo-native verification surfaces: ${workflowSurfaces.verification_surfaces.slice(0, 6).join('; ')}${workflowSurfaces.verification_surfaces.length > 6 ? '; ...' : ''}`,
    );
  }

  if (Object.keys(scripts).length > 0) {
    notes.push(
      'Add `## Execution` / `## Verification` bullets to the task contract to override these repo-default commands with a tighter task recipe.',
    );
  }

  return {
    run_commands: unique(runCommands),
    verify_commands: unique(verifyCommands),
    evidence: [],
    notes: unique(notes),
    scope_paths: [],
  };
}

export async function resolveTaskRecipe(
  input: TaskRecipeResolutionInput,
  cwd = process.cwd(),
): Promise<ResolvedTaskRecipe> {
  const authored = input.task_recipe ?? {
    run_commands: [],
    verify_commands: [],
    evidence: [],
    notes: [],
    scope_paths: [],
  };
  const inferred = await inferRecipeFromRepo(input, cwd);

  const usedAuthored = authored.run_commands.length > 0
    || authored.verify_commands.length > 0
    || authored.evidence.length > 0
    || authored.notes.length > 0;

  const usedInferredRun = authored.run_commands.length === 0 && inferred.run_commands.length > 0;
  const usedInferredVerify = authored.verify_commands.length === 0 && inferred.verify_commands.length > 0;
  const usedInferredNotes = inferred.notes.length > 0;
  const usedInferred = usedInferredRun || usedInferredVerify || usedInferredNotes;

  const source: ResolvedTaskRecipe['source'] = usedAuthored
    ? usedInferred
      ? 'mixed'
      : 'task'
    : usedInferred
      ? 'repo_inferred'
      : 'none';

  return {
    source,
    run_commands: authored.run_commands.length > 0 ? authored.run_commands : inferred.run_commands,
    verify_commands: authored.verify_commands.length > 0 ? authored.verify_commands : inferred.verify_commands,
    evidence: authored.evidence,
    notes: unique([
      ...authored.notes,
      ...(usedInferred ? inferred.notes : []),
    ]),
    scope_paths: authored.scope_paths,
  };
}
