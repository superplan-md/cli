const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'superplan');

const FRONTEND_CHANGES = [
  {
    id: 'feature-auth-ui',
    title: 'Authentication UI',
    state: 'done',
    tasks: [
      { id: 'T-001', title: 'Login screen', status: 'completed' },
      { id: 'T-002', title: 'Signup flow', status: 'completed' },
      { id: 'T-003', title: 'OAuth buttons', status: 'completed' },
      { id: 'T-004', title: 'Forgot password', status: 'completed' },
    ]
  },
  {
    id: 'feature-dashboard-ui',
    title: 'Main Dashboard UI',
    state: 'in_progress',
    tasks: [
      { id: 'T-001', title: 'Design layout grid', status: 'completed' },
      { id: 'T-002', title: 'Implement sidebar', status: 'in_progress' },
      { id: 'T-003', title: 'Chart components', status: 'pending' },
      { id: 'T-004', title: 'Dark mode styling', status: 'pending' },
    ]
  },
  {
    id: 'feature-settings-ui',
    title: 'User Settings UI',
    state: 'needs_feedback',
    tasks: [
      { id: 'T-001', title: 'Profile form', status: 'completed' },
      { id: 'T-002', title: 'Avatar cropping tool', status: 'needs_feedback' },
      { id: 'T-003', title: 'Theme toggle', status: 'pending' },
      { id: 'T-004', title: 'Save confirmation', status: 'pending' },
    ]
  },
  {
    id: 'tech-debt-frontend',
    title: 'React 19 Upgrade',
    state: 'backlog',
    tasks: [
      { id: 'T-001', title: 'Update React', status: 'pending' },
      { id: 'T-002', title: 'Fix deprecations', status: 'pending' },
      { id: 'T-003', title: 'Refactor context', status: 'pending' },
      { id: 'T-004', title: 'Verify bundle size', status: 'pending' },
    ]
  }
];

const BACKEND_CHANGES = [
  {
    id: 'feature-auth-api',
    title: 'Authentication API',
    state: 'done',
    tasks: [
      { id: 'T-001', title: 'User table schema', status: 'completed' },
      { id: 'T-002', title: 'JWT generation', status: 'completed' },
      { id: 'T-003', title: 'Password hashing', status: 'completed' },
      { id: 'T-004', title: 'OAuth endpoints', status: 'completed' },
    ]
  },
  {
    id: 'feature-dashboard-api',
    title: 'Analytics Endpoints',
    state: 'in_progress',
    tasks: [
      { id: 'T-001', title: 'Time-series aggregates', status: 'completed' },
      { id: 'T-002', title: 'User activity feed', status: 'in_progress' },
      { id: 'T-003', title: 'Revenue metrics', status: 'pending' },
      { id: 'T-004', title: 'Caching layer', status: 'pending' },
    ]
  },
  {
    id: 'feature-webhooks',
    title: 'Outbound Webhooks',
    state: 'needs_feedback',
    tasks: [
      { id: 'T-001', title: 'Webhook subscription model', status: 'completed' },
      { id: 'T-002', title: 'Payload signing', status: 'needs_feedback' },
      { id: 'T-003', title: 'Delivery retries', status: 'pending' },
      { id: 'T-004', title: 'Webhook dashboard API', status: 'pending' },
    ]
  },
  {
    id: 'tech-debt-backend',
    title: 'Postgres Indexing',
    state: 'backlog',
    tasks: [
      { id: 'T-001', title: 'Analyze slow queries', status: 'pending' },
      { id: 'T-002', title: 'Add missing indexes', status: 'pending' },
      { id: 'T-003', title: 'Optimize joins', status: 'pending' },
      { id: 'T-004', title: 'Run load tests', status: 'pending' },
    ]
  }
];

const WORKSPACES = [
  { id: 'workspace-frontend-app', changes: FRONTEND_CHANGES },
  { id: 'workspace-backend-api', changes: BACKEND_CHANGES }
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

function generateOverlaySnapshot(wsPath, wsId, changes) {
  const now = new Date().toISOString();
  
  const tracked_changes = changes.map(c => {
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
  // First clean up old directories to avoid merging old and new data
  const oldWsDirs = ['workspace-frontend-app', 'workspace-backend-api'];
  for (const ws of oldWsDirs) {
    const wsDir = path.join(CONFIG_DIR, ws);
    if (fs.existsSync(wsDir)) {
      fs.rmSync(wsDir, { recursive: true, force: true });
    }
  }

  for (const ws of WORKSPACES) {
    const wsDir = path.join(CONFIG_DIR, ws.id);
    const changesDir = path.join(wsDir, 'changes');
    const runtimeDir = path.join(wsDir, 'runtime');
    
    fs.mkdirSync(changesDir, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });

    // Write overlay.json
    const wsPath = path.join(os.homedir(), ws.id.replace('workspace-', ''));
    fs.writeFileSync(
      path.join(runtimeDir, 'overlay.json'),
      JSON.stringify(generateOverlaySnapshot(wsPath, ws.id, ws.changes), null, 2)
    );

    for (const change of ws.changes) {
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
    console.log(`Populated dummy data for workspace: ${ws.id}`);
  }
}

main();
