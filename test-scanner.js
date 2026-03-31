const fs = require('fs');
const path = require('path');
const os = require('os');

const GLOBAL_SUPERPLAN_DIR = path.join(os.homedir(), '.config', 'superplan');

function toDesktopChangeStatus(status) {
  if (status === 'done') return 'done'
  if (status === 'in_progress' || status === 'tracking' || status === 'blocked' || status === 'needs_feedback') {
    return 'active'
  }
  return 'idle'
}

function toDesktopChange(change) {
  const taskCount = change.task_total
  const completedTaskCount = change.task_done

  return {
    id: change.change_id,
    title: change.title,
    stateScore: taskCount > 0 ? Math.round((completedTaskCount / taskCount) * 100) : 0,
    lastActiveAt: change.updated_at,
    inProgress: change.status === 'in_progress' || change.status === 'tracking',
    unread: false,
    taskCount,
    completedTaskCount,
    status: toDesktopChangeStatus(change.status)
  }
}

const entries = fs.readdirSync(GLOBAL_SUPERPLAN_DIR, { withFileTypes: true });
const validDirs = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith('workspace-'));

const snapshots = validDirs.map(entry => {
  const snapshotPath = path.join(GLOBAL_SUPERPLAN_DIR, entry.name, 'runtime', 'overlay.json');
  if (!fs.existsSync(snapshotPath)) return null;
  
  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  const parsed = JSON.parse(raw);
  
  return parsed;
}).filter(s => s !== null);

const workspaces = snapshots.map((snapshot) => {
  const workspacePath = snapshot.workspace_path
  const changes = [...snapshot.tracked_changes]
    .map(toDesktopChange)
    .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt))

  return {
    id: path.basename(workspacePath).toLowerCase().replace(/[^a-z0-9]/g, '-') || 'workspace-root',
    name: path.basename(workspacePath),
    path: workspacePath,
    lastActiveAt: snapshot.updated_at,
    changes
  }
})

console.log(JSON.stringify(workspaces, null, 2));
