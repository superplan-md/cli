import * as fs from 'fs/promises';
import * as path from 'path';

export interface GraphDiagnostic {
  code: string;
  message: string;
  change_id?: string;
  task_id?: string;
}

export interface GraphTaskEntry {
  task_id: string;
  title: string;
  depends_on_all: string[];
  depends_on_any: string[];
  workstream: string | null;
  exclusive_group: string | null;
}

export interface GraphWorkstream {
  id: string;
  title: string;
}

export interface ChangeGraph {
  change_id: string;
  title: string | null;
  tasks: GraphTaskEntry[];
  workstreams: GraphWorkstream[];
  path: string;
}

function parseSections(lines: string[]): Record<string, string[]> {
  const sections: Record<string, string[]> = {};
  let currentSection = '';

  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.slice(3).trim();
      if (!(currentSection in sections)) {
        sections[currentSection] = [];
      }
      continue;
    }

    if (currentSection) {
      sections[currentSection].push(line);
    }
  }

  return sections;
}

function normalizeInlineValue(value: string): string {
  return value.trim().replace(/^['"`]|['"`]$/g, '');
}

function parseInlineArray(value: string): string[] {
  const trimmedValue = value.trim();
  if (!trimmedValue || trimmedValue === '[]') {
    return [];
  }

  const normalizedValue = trimmedValue.startsWith('[') && trimmedValue.endsWith(']')
    ? trimmedValue.slice(1, -1)
    : trimmedValue;

  return normalizedValue
    .split(',')
    .map(item => normalizeInlineValue(item))
    .filter(Boolean);
}

function parseGraphMetadata(
  lines: string[],
  expectedChangeId: string,
  diagnostics: GraphDiagnostic[],
): { changeId: string; title: string | null } {
  let changeId = '';
  let title: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const matchedChangeId = /^- Change ID:\s+`([^`]+)`$/.exec(line);
    if (matchedChangeId) {
      changeId = matchedChangeId[1];
      continue;
    }

    const matchedTitle = /^- Title:\s+(.+)$/.exec(line);
    if (matchedTitle) {
      title = matchedTitle[1].trim();
    }
  }

  if (!changeId) {
    diagnostics.push({
      code: 'GRAPH_CHANGE_ID_MISSING',
      message: 'Graph metadata is missing a `Change ID` entry.',
      change_id: expectedChangeId,
    });
    changeId = expectedChangeId;
  } else if (changeId !== expectedChangeId) {
    diagnostics.push({
      code: 'GRAPH_CHANGE_ID_MISMATCH',
      message: `Graph change id "${changeId}" does not match change directory "${expectedChangeId}".`,
      change_id: expectedChangeId,
    });
  }

  return { changeId, title };
}

function parseWorkstreams(lines: string[]): GraphWorkstream[] {
  return lines
    .map(line => /^- `([^`]+)`\s+(.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(match => ({
      id: match[1],
      title: match[2].trim(),
    }));
}

function parseGraphLayout(
  lines: string[],
  changeId: string,
  diagnostics: GraphDiagnostic[],
): GraphTaskEntry[] {
  const tasks: GraphTaskEntry[] = [];
  let currentTask: GraphTaskEntry | null = null;

  const flushCurrentTask = () => {
    if (currentTask) {
      tasks.push(currentTask);
      currentTask = null;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const taskEntryMatch = /^- `([^`]+)`\s+(.+)$/.exec(line.trim());
    if (taskEntryMatch) {
      flushCurrentTask();
      currentTask = {
        task_id: taskEntryMatch[1],
        title: taskEntryMatch[2].trim(),
        depends_on_all: [],
        depends_on_any: [],
        workstream: null,
        exclusive_group: null,
      };
      continue;
    }

    const fieldMatch = /^\s{2,}-\s+([a-z_]+):\s*(.*)$/.exec(rawLine);
    if (fieldMatch && currentTask) {
      const [, fieldName, rawValue] = fieldMatch;
      if (fieldName === 'depends_on_all') {
        currentTask.depends_on_all = parseInlineArray(rawValue);
      } else if (fieldName === 'depends_on_any') {
        currentTask.depends_on_any = parseInlineArray(rawValue);
      } else if (fieldName === 'workstream') {
        currentTask.workstream = normalizeInlineValue(rawValue) || null;
      } else if (fieldName === 'exclusive_group') {
        currentTask.exclusive_group = normalizeInlineValue(rawValue) || null;
      } else {
        diagnostics.push({
          code: 'GRAPH_TASK_FIELD_UNKNOWN',
          message: `Unknown graph task field "${fieldName}" in ${changeId}.`,
          change_id: changeId,
          task_id: currentTask.task_id,
        });
      }
      continue;
    }

    diagnostics.push({
      code: 'GRAPH_TASK_ENTRY_INVALID',
      message: `Invalid graph layout line: ${line.trim()}`,
      change_id: changeId,
      ...(currentTask ? { task_id: currentTask.task_id } : {}),
    });
  }

  flushCurrentTask();
  return tasks;
}

function validateTaskEntries(
  changeId: string,
  tasks: GraphTaskEntry[],
  workstreams: GraphWorkstream[],
  diagnostics: GraphDiagnostic[],
): void {
  const taskIds = new Set<string>();
  const workstreamIds = new Set(workstreams.map(workstream => workstream.id));

  for (const task of tasks) {
    if (taskIds.has(task.task_id)) {
      diagnostics.push({
        code: 'TASK_ENTRY_DUPLICATE',
        message: `Task graph declares duplicate task id ${task.task_id}.`,
        change_id: changeId,
        task_id: task.task_id,
      });
      continue;
    }

    taskIds.add(task.task_id);
  }

  for (const task of tasks) {
    if (task.workstream && !workstreamIds.has(task.workstream)) {
      diagnostics.push({
        code: 'WORKSTREAM_UNDECLARED',
        message: `Task ${task.task_id} references undeclared workstream ${task.workstream}.`,
        change_id: changeId,
        task_id: task.task_id,
      });
    }

    for (const dependencyTaskId of [...task.depends_on_all, ...task.depends_on_any]) {
      if (!taskIds.has(dependencyTaskId)) {
        diagnostics.push({
          code: 'DEPENDENCY_TARGET_UNKNOWN',
          message: `Task ${task.task_id} references unknown dependency ${dependencyTaskId}.`,
          change_id: changeId,
          task_id: task.task_id,
        });
      }

      if (dependencyTaskId === task.task_id) {
        diagnostics.push({
          code: 'DEPENDENCY_SELF_REFERENCE',
          message: `Task ${task.task_id} cannot depend on itself.`,
          change_id: changeId,
          task_id: task.task_id,
        });
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const taskMap = new Map(tasks.map(task => [task.task_id, task]));

  const visit = (taskId: string, stack: string[]) => {
    if (visited.has(taskId) || visiting.has(taskId)) {
      if (visiting.has(taskId)) {
        diagnostics.push({
          code: 'DEPENDENCY_CYCLE',
          message: `Task dependency cycle detected: ${[...stack, taskId].join(' -> ')}`,
          change_id: changeId,
          task_id: taskId,
        });
      }
      return;
    }

    const task = taskMap.get(taskId);
    if (!task) {
      return;
    }

    visiting.add(taskId);
    for (const dependencyTaskId of task.depends_on_all) {
      visit(dependencyTaskId, [...stack, taskId]);
    }
    for (const dependencyTaskId of task.depends_on_any) {
      visit(dependencyTaskId, [...stack, taskId]);
    }
    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) {
    visit(task.task_id, []);
  }
}

export async function loadChangeGraph(changeDir: string): Promise<{ graph?: ChangeGraph; diagnostics: GraphDiagnostic[] }> {
  const diagnostics: GraphDiagnostic[] = [];
  const changeId = path.basename(changeDir);
  const graphPath = path.join(changeDir, 'tasks.md');

  let content = '';
  try {
    content = await fs.readFile(graphPath, 'utf-8');
  } catch {
    diagnostics.push({
      code: 'GRAPH_FILE_MISSING',
      message: `Missing task graph: ${path.relative(process.cwd(), graphPath) || graphPath}`,
      change_id: changeId,
    });
    return { diagnostics };
  }

  const lines = content.split(/\r?\n/);
  const firstNonEmptyLine = lines.find(line => line.trim().length > 0)?.trim() ?? '';
  if (firstNonEmptyLine !== '# Task Graph') {
    diagnostics.push({
      code: 'GRAPH_TITLE_INVALID',
      message: 'Task graph must start with "# Task Graph".',
      change_id: changeId,
    });
  }

  const sections = parseSections(lines);
  for (const requiredSection of ['Graph Metadata', 'Graph Layout']) {
    if (!(requiredSection in sections)) {
      diagnostics.push({
        code: 'GRAPH_SECTION_MISSING',
        message: `Task graph is missing required section "${requiredSection}".`,
        change_id: changeId,
      });
    }
  }

  const metadata = parseGraphMetadata(sections['Graph Metadata'] ?? [], changeId, diagnostics);
  const workstreams = parseWorkstreams(sections.Workstreams ?? []);
  const tasks = parseGraphLayout(sections['Graph Layout'] ?? [], metadata.changeId, diagnostics);
  validateTaskEntries(metadata.changeId, tasks, workstreams, diagnostics);

  return {
    graph: {
      change_id: metadata.changeId,
      title: metadata.title,
      tasks,
      workstreams,
      path: graphPath,
    },
    diagnostics,
  };
}
