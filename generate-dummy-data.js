const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'superplan');

const WORKSPACES = [
  'workspace-frontend-app',
  'workspace-backend-api'
];

const CHANGES = [
  {
    id: 'feature-auth',
    title: 'Authentication Feature',
    state: 'done',
    tasks: [
      { id: 'T-001', title: 'Setup DB schema', status: 'completed' },
      { id: 'T-002', title: 'Create login endpoint', status: 'completed' },
      { id: 'T-003', title: 'Build login UI', status: 'completed' },
      { id: 'T-004', title: 'E2E tests for auth', status: 'completed' },
    ]
  },
  {
    id: 'feature-dashboard',
    title: 'Main Dashboard',
    state: 'in_progress',
    tasks: [
      { id: 'T-001', title: 'Design layout', status: 'completed' },
      { id: 'T-002', title: 'Implement sidebar', status: 'in_progress' },
      { id: 'T-003', title: 'Fetch data widgets', status: 'pending' },
      { id: 'T-004', title: 'Responsive styling', status: 'pending' },
    ]
  },
  {
    id: 'feature-settings',
    title: 'User Settings Profile',
    state: 'needs_feedback',
    tasks: [
      { id: 'T-001', title: 'Profile picture upload', status: 'completed' },
      { id: 'T-002', title: 'Avatar cropping', status: 'needs_feedback' },
      { id: 'T-003', title: 'Theme toggle', status: 'pending' },
      { id: 'T-004', title: 'Save preferences', status: 'pending' },
    ]
  },
  {
    id: 'tech-debt',
    title: 'Dependency Updates',
    state: 'backlog',
    tasks: [
      { id: 'T-001', title: 'Update React', status: 'pending' },
      { id: 'T-002', title: 'Update Tailwind', status: 'pending' },
      { id: 'T-003', title: 'Fix breaking changes', status: 'pending' },
      { id: 'T-004', title: 'Verify bundle size', status: 'pending' },
    ]
  }
];

function generateTaskFile(changeId, task) {
  const isDone = task.status === 'completed';
  const checkbox = isDone ? '[x]' : '[ ]';
  return `---
task_id: ${task.id}
status: ${task.status}
priority: medium
---

## Description
${task.title} implementation for ${changeId}.

## Acceptance Criteria
- ${checkbox} Ensure implementation meets requirements
- ${checkbox} Write unit tests
`;
}

function generateGraphFile(change) {
  let graphContent = `# Task Graph

## Graph Metadata
- Change ID: \`${change.id}\`
- Title: ${change.title}

## Graph Layout
`;

  change.tasks.forEach((t, i) => {
    graphContent += `- \`${t.id}\` ${t.title}\n`;
    if (i > 0) {
      graphContent += `  - depends_on_all: [\`${change.tasks[i-1].id}\`]\n`;
    }
  });

  return graphContent;
}

function generateOverlaySnapshot(wsPath, ws) {
  const now = new Date().toISOString();
  
  const tracked_changes = CHANGES.map(c => {
    const task_total = c.tasks.length;
    const task_done = c.tasks.filter(t => t.status === 'completed').length;
    
    return {
      change_id: c.id,
      title: c.title,
      status: c.state,
      task_total,
      task_done,
      updated_at: now
    };
  });

  return {
    workspace_path: wsPath,
    session_id: 'session-dummy',
    updated_at: now,
    tracked_changes,
    focused_change: null,
    active_task: null,
    board: {
      in_progress: [], backlog: [], done: [], blocked: [], needs_feedback: []
    },
    attention_state: 'normal',
    events: []
  };
}

function main() {
  for (const ws of WORKSPACES) {
    const wsDir = path.join(CONFIG_DIR, ws);
    const changesDir = path.join(wsDir, 'changes');
    const runtimeDir = path.join(wsDir, 'runtime');
    
    fs.mkdirSync(changesDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });

    // Write overlay.json
    const wsPath = path.join(os.homedir(), ws.replace('workspace-', ''));
    fs.writeFileSync(
      path.join(runtimeDir, 'overlay.json'),
      JSON.stringify(generateOverlaySnapshot(wsPath, ws), null, 2)
    );

    for (const change of CHANGES) {
      const changeDir = path.join(changesDir, change.id);
      const tasksDir = path.join(changeDir, 'tasks');
      fs.mkdirSync(tasksDir, { recursive: true });

      fs.writeFileSync(
        path.join(changeDir, 'tasks.md'),
        generateGraphFile(change)
      );

      for (const task of change.tasks) {
        fs.writeFileSync(
          path.join(tasksDir, `${task.id}.md`),
          generateTaskFile(change.id, task)
        );
      }
    }
    console.log(`Populated data for workspace: ${ws}`);
  }
}

main();
