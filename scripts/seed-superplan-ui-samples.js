#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');

const HOME = os.homedir();
const SUPERPLAN_ROOT = path.join(HOME, '.config', 'superplan');
const SAMPLE_WORKSPACE_ROOT = path.join(HOME, 'superplan-ui-samples');

function sanitizeSegment(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

function sha10(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

function realPathOrResolve(targetPath) {
  try {
    return fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function ensureDir(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function writeText(targetPath, content) {
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, 'utf8');
}

function writeJson(targetPath, value) {
  writeText(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}

function removeDirIfPresent(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function isoHoursAgo(hoursAgo) {
  return new Date(Date.now() - (hoursAgo * 60 * 60 * 1000)).toISOString();
}

function getOverlayDirName(workspacePath) {
  const normalizedWorkspacePath = realPathOrResolve(workspacePath);
  const workspaceName = sanitizeSegment(path.basename(normalizedWorkspacePath)) || 'root';
  return `workspace-${workspaceName}-${sha10(normalizedWorkspacePath)}`;
}

function getProjectDirName(workspacePath) {
  const normalizedWorkspacePath = realPathOrResolve(workspacePath);
  const projectName = sanitizeSegment(path.basename(normalizedWorkspacePath)) || 'root';
  return `project-${projectName}-${sha10(normalizedWorkspacePath)}`;
}

function toRuntimeStatus(status) {
  if (
    status === 'done' ||
    status === 'in_progress' ||
    status === 'blocked' ||
    status === 'needs_feedback' ||
    status === 'in_review'
  ) {
    return status;
  }

  return 'pending';
}

function toOverlayBoardStatus(status) {
  if (
    status === 'done' ||
    status === 'in_progress' ||
    status === 'blocked' ||
    status === 'needs_feedback'
  ) {
    return status;
  }

  return 'backlog';
}

function computeTaskProgress(task) {
  const total = task.acceptanceCriteria.length;
  const completed = task.acceptanceCriteria.filter((item) => item.done).length;
  const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, completed, progressPercent };
}

function computeTaskUpdatedAt(task) {
  if (typeof task.updatedHoursAgo === 'number') {
    return isoHoursAgo(task.updatedHoursAgo);
  }

  if (typeof task.completedHoursAgo === 'number') {
    return isoHoursAgo(task.completedHoursAgo);
  }

  if (typeof task.startedHoursAgo === 'number') {
    return isoHoursAgo(task.startedHoursAgo);
  }

  return isoHoursAgo(0);
}

function computeChangeUpdatedAt(change) {
  const timestamps = change.tasks.map((task) => Date.parse(computeTaskUpdatedAt(task)));
  return new Date(Math.max(...timestamps)).toISOString();
}

function deriveChangeStatus(change) {
  if (change.tasks.length === 0) {
    return 'tracking';
  }

  if (change.tasks.some((task) => task.status === 'needs_feedback')) {
    return 'needs_feedback';
  }

  if (change.tasks.some((task) => task.status === 'in_progress')) {
    return 'in_progress';
  }

  if (change.tasks.some((task) => task.status === 'blocked')) {
    return 'blocked';
  }

  if (change.tasks.every((task) => task.status === 'done')) {
    return 'done';
  }

  return 'backlog';
}

function buildTaskContract(change, task) {
  const acceptanceLines = task.acceptanceCriteria
    .map((item) => `- [${item.done ? 'x' : ' '}] ${item.text}`)
    .join('\n');

  return [
    '---',
    `task_id: ${task.id}`,
    `change_id: ${change.slug}`,
    `title: ${task.title}`,
    `status: ${toRuntimeStatus(task.status)}`,
    `priority: ${task.priority}`,
    '---',
    '',
    '## Description',
    task.description,
    '',
    '## Acceptance Criteria',
    acceptanceLines,
    '',
  ].join('\n');
}

function buildTasksIndex(change) {
  const lines = [
    '# Task Graph',
    '',
    '## Graph Metadata',
    `- Change ID: \`${change.slug}\``,
    `- Title: ${change.title}`,
    '',
    '## Graph Layout',
  ];

  for (const task of change.tasks) {
    lines.push(`- \`${task.id}\` ${task.title}`);
    if (task.dependsOnAll && task.dependsOnAll.length > 0) {
      lines.push(`  - depends_on_all: [${task.dependsOnAll.map((value) => `\`${value}\``).join(', ')}]`);
    }
    if (task.dependsOnAny && task.dependsOnAny.length > 0) {
      lines.push(`  - depends_on_any: [${task.dependsOnAny.map((value) => `\`${value}\``).join(', ')}]`);
    }
  }

  lines.push('');
  lines.push('## Notes');
  lines.push(`- ${change.summary}`);
  lines.push('');

  return lines.join('\n');
}

function buildPlan(change) {
  return [
    `# ${change.title}`,
    '',
    change.summary,
    '',
    '## Focus',
    ...change.focus.map((line) => `- ${line}`),
    '',
  ].join('\n');
}

function buildWorkspaceReadme(workspace) {
  return [
    `# ${workspace.name}`,
    '',
    'Generated sample workspace for Superplan desktop UI testing.',
    '',
    workspace.description,
    '',
    '## Seeded Changes',
    ...workspace.changes.map((change) => `- ${change.title} (\`${change.slug}\`)`),
    '',
  ].join('\n');
}

function buildRuntimeTasksJson(workspace) {
  const changes = {};

  for (const change of workspace.changes) {
    const tasks = {};
    for (const task of change.tasks) {
      const runtimeTask = {
        status: toRuntimeStatus(task.status),
        updated_at: computeTaskUpdatedAt(task),
      };

      if (typeof task.startedHoursAgo === 'number') {
        runtimeTask.started_at = isoHoursAgo(task.startedHoursAgo);
      }

      if (typeof task.completedHoursAgo === 'number') {
        runtimeTask.completed_at = isoHoursAgo(task.completedHoursAgo);
      }

      if (task.reason) {
        runtimeTask.reason = task.reason;
      }

      if (task.message) {
        runtimeTask.message = task.message;
      }

      tasks[task.id] = runtimeTask;
    }

    changes[change.slug] = {
      active_task_ref: change.activeTaskRef ?? null,
      updated_at: computeChangeUpdatedAt(change),
      tasks,
    };
  }

  return { changes };
}

function buildOverlayTask(change, task) {
  const progress = computeTaskProgress(task);
  const overlayTask = {
    task_id: task.id,
    change_id: change.slug,
    task_ref: `${change.slug}/${task.id}`,
    title: task.title,
    description: task.description,
    status: toOverlayBoardStatus(task.status),
    completed_acceptance_criteria: progress.completed,
    total_acceptance_criteria: progress.total,
    progress_percent: progress.progressPercent,
    updated_at: computeTaskUpdatedAt(task),
  };

  if (typeof task.startedHoursAgo === 'number') {
    overlayTask.started_at = isoHoursAgo(task.startedHoursAgo);
  }

  if (typeof task.completedHoursAgo === 'number') {
    overlayTask.completed_at = isoHoursAgo(task.completedHoursAgo);
  }

  if (task.reason) {
    overlayTask.reason = task.reason;
  }

  if (task.message) {
    overlayTask.message = task.message;
  }

  return overlayTask;
}

function buildOverlaySnapshot(workspace) {
  const trackedChanges = workspace.changes.map((change) => {
    const changeStatus = deriveChangeStatus(change);
    const updatedAt = computeChangeUpdatedAt(change);
    const taskTotal = change.tasks.length;
    const taskDone = change.tasks.filter((task) => task.status === 'done').length;

    return {
      change_id: change.slug,
      title: change.title,
      status: changeStatus,
      task_total: taskTotal,
      task_done: taskDone,
      updated_at: updatedAt,
      ...(changeStatus === 'needs_feedback' && change.agent
        ? {
            agent_id: change.agent.id,
            agent_name: change.agent.name,
          }
        : {}),
    };
  });

  const overlayTasks = workspace.changes.flatMap((change) =>
    change.tasks.map((task) => buildOverlayTask(change, task))
  );

  const activeTask = overlayTasks.find((task) => task.status === 'in_progress') ?? null;
  const focusedChange = trackedChanges.find((change) => change.status !== 'done') ?? trackedChanges[0] ?? null;
  const attentionState = overlayTasks.some((task) => task.status === 'needs_feedback')
    ? 'needs_feedback'
    : trackedChanges.length > 0 && trackedChanges.every((change) => change.status === 'done')
      ? 'all_tasks_done'
      : 'normal';

  const updatedAt = trackedChanges.length > 0
    ? trackedChanges
        .map((change) => Date.parse(change.updated_at))
        .reduce((latest, current) => Math.max(latest, current), 0)
    : Date.now();

  const events = [];
  if (attentionState === 'needs_feedback') {
    events.push({
      id: `needs_feedback:${updatedAt}`,
      kind: 'needs_feedback',
      created_at: new Date(updatedAt).toISOString(),
    });
  }

  return {
    workspace_path: workspace.path,
    session_id: `workspace:${workspace.path}`,
    updated_at: new Date(updatedAt).toISOString(),
    tracked_changes: trackedChanges,
    focused_change: focusedChange,
    active_task: activeTask,
    board: {
      in_progress: overlayTasks.filter((task) => task.status === 'in_progress'),
      backlog: overlayTasks.filter((task) => task.status === 'backlog'),
      done: overlayTasks.filter((task) => task.status === 'done'),
      blocked: overlayTasks.filter((task) => task.status === 'blocked'),
      needs_feedback: overlayTasks.filter((task) => task.status === 'needs_feedback'),
    },
    attention_state: attentionState,
    events,
  };
}

const WORKSPACES = [
  {
    name: 'Aurora Shop',
    description: 'Frontend storefront workspace with a hot checkout fix, a blocked launch stream, and one completed cleanup change.',
    files: {
      'package.json': JSON.stringify({
        name: 'aurora-shop',
        private: true,
        scripts: {
          dev: 'vite',
          test: 'vitest',
        },
      }, null, 2),
      'src/checkout.tsx': [
        'export function CheckoutEntry() {',
        "  return 'Aurora Shop checkout sample';",
        '}',
        '',
      ].join('\n'),
    },
    changes: [
      {
        slug: 'checkout-rescue',
        title: 'Checkout Rescue',
        summary: 'Stabilize the payment retry path before the next promo push.',
        focus: [
          'Patch duplicate-charge guardrails in checkout submission.',
          'Recover a clean retry UX for soft declines.',
          'Add the canary metrics needed for rollout confidence.',
        ],
        activeTaskRef: 'T-002',
        tasks: [
          {
            id: 'T-001',
            title: 'Audit checkout error clusters',
            priority: 'high',
            status: 'done',
            description: 'Map the recent checkout failures by provider, device cohort, and retry pattern.',
            startedHoursAgo: 54,
            completedHoursAgo: 46,
            updatedHoursAgo: 46,
            acceptanceCriteria: [
              { text: 'Export the top checkout error buckets from the last 7 days', done: true },
              { text: 'Tag the three worst duplicate-charge retry loops', done: true },
              { text: 'Hand support a short mitigation memo for customer replies', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Patch duplicate payment guard',
            priority: 'high',
            status: 'in_progress',
            description: 'Introduce a server-backed idempotency check before the final payment confirmation step.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 8,
            updatedHoursAgo: 1.2,
            acceptanceCriteria: [
              { text: 'Persist a checkout attempt token before payment capture', done: true },
              { text: 'Reject duplicate submit clicks within the active cart session', done: true },
              { text: 'Expose a recoverable retry path for declined payments', done: false },
              { text: 'Capture duplicate-guard metrics for the canary cohort', done: false },
            ],
          },
          {
            id: 'T-003',
            title: 'Add retry banner in checkout',
            priority: 'medium',
            status: 'pending',
            description: 'Show a tailored recovery banner when the payment gateway returns a soft decline.',
            dependsOnAll: ['T-002'],
            updatedHoursAgo: 2.8,
            acceptanceCriteria: [
              { text: 'Render a soft-decline message with the next best retry action', done: false },
              { text: 'Keep saved cart contents intact after a decline', done: false },
              { text: 'Track banner impressions for checkout support analysis', done: false },
            ],
          },
          {
            id: 'T-004',
            title: 'Roll out canary metrics',
            priority: 'low',
            status: 'pending',
            description: 'Wire dashboards and alerts so the checkout patch can ship behind a staged rollout.',
            dependsOnAny: ['T-002', 'T-003'],
            updatedHoursAgo: 4.4,
            acceptanceCriteria: [
              { text: 'Add a dashboard for duplicate-payment rejects', done: false },
              { text: 'Alert on retry loops that exceed the current baseline', done: false },
              { text: 'Document the rollback threshold for operations', done: false },
            ],
          },
        ],
      },
      {
        slug: 'summer-launch-merch',
        title: 'Summer Launch Merch',
        summary: 'Bundle the seasonal merch release and storefront messaging for the launch window.',
        focus: [
          'Finalize the storefront merch bundle copy.',
          'Sync offer details with marketing and support.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Finalize hero asset crop set',
            priority: 'medium',
            status: 'done',
            description: 'Approve the final hero crops and store them in the launch asset pack.',
            startedHoursAgo: 40,
            completedHoursAgo: 32,
            updatedHoursAgo: 32,
            acceptanceCriteria: [
              { text: 'Approve desktop, tablet, and mobile crops', done: true },
              { text: 'Upload the final export set for merch launch', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Sync product copy with brand team',
            priority: 'high',
            status: 'blocked',
            description: 'Pull the final product bundle copy into the storefront launch configuration.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 7,
            updatedHoursAgo: 1.5,
            reason: 'Waiting on the final copy freeze from brand before the bundle names can ship.',
            acceptanceCriteria: [
              { text: 'Replace placeholder bundle copy with approved launch text', done: true },
              { text: 'Confirm the promo terms in the cart summary', done: false },
              { text: 'Update support macros to match the offer language', done: false },
            ],
          },
          {
            id: 'T-003',
            title: 'QA promo bundle edge cases',
            priority: 'medium',
            status: 'pending',
            description: 'Verify the cart math and inventory labels for multi-item promo bundles.',
            dependsOnAll: ['T-002'],
            updatedHoursAgo: 5.5,
            acceptanceCriteria: [
              { text: 'Verify bundle discounts on mixed-size carts', done: false },
              { text: 'Confirm sold-out states degrade gracefully', done: false },
            ],
          },
        ],
      },
      {
        slug: 'cart-cleanup',
        title: 'Cart Cleanup',
        summary: 'Remove old cart debt before the next round of storefront work.',
        focus: [
          'Retire stale cart flags.',
          'Archive obsolete experiments and QA switches.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Delete dead promo toggles',
            priority: 'medium',
            status: 'done',
            description: 'Remove unused promo toggles that no longer affect the cart experience.',
            startedHoursAgo: 96,
            completedHoursAgo: 88,
            updatedHoursAgo: 88,
            acceptanceCriteria: [
              { text: 'Delete the retired cart experiment flags', done: true },
              { text: 'Verify promo fallback logic still matches production', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Collapse duplicate cart helpers',
            priority: 'low',
            status: 'done',
            description: 'Unify the cart helper layer so duplicate pricing helpers disappear.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 84,
            completedHoursAgo: 72,
            updatedHoursAgo: 72,
            acceptanceCriteria: [
              { text: 'Keep one pricing helper path in the shared cart module', done: true },
              { text: 'Update tests for the merged helper signatures', done: true },
            ],
          },
          {
            id: 'T-003',
            title: 'Archive stale QA scripts',
            priority: 'low',
            status: 'done',
            description: 'Archive the old manual QA scripts that no longer match the checkout surface.',
            dependsOnAll: ['T-002'],
            startedHoursAgo: 70,
            completedHoursAgo: 62,
            updatedHoursAgo: 62,
            acceptanceCriteria: [
              { text: 'Archive the stale checkout QA playbook', done: true },
              { text: 'Link the current smoke pass in the team handbook', done: true },
            ],
          },
        ],
      },
      {
        slug: 'loyalty-migration',
        title: 'Loyalty Migration',
        summary: 'Queue the loyalty ledger migration for a later planning pass.',
        focus: [
          'Scope the data shape before any implementation starts.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Draft migration shape',
            priority: 'medium',
            status: 'pending',
            description: 'Outline the customer ledger fields required for the loyalty migration.',
            updatedHoursAgo: 20,
            acceptanceCriteria: [
              { text: 'List the ledger fields needed from the current loyalty platform', done: false },
              { text: 'Capture the expected cutover constraints for support', done: false },
            ],
          },
          {
            id: 'T-002',
            title: 'Estimate backfill windows',
            priority: 'low',
            status: 'pending',
            description: 'Estimate the backfill window options before locking the migration plan.',
            dependsOnAll: ['T-001'],
            updatedHoursAgo: 18,
            acceptanceCriteria: [
              { text: 'Produce backfill timing options for engineering review', done: false },
              { text: 'Document the user-visible cutover risk for each option', done: false },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Meridian API',
    description: 'Backend service workspace with one feedback request, one active rate-limit change, and completed incident follow-up.',
    files: {
      'package.json': JSON.stringify({
        name: 'meridian-api',
        private: true,
        scripts: {
          dev: 'tsx watch src/server.ts',
          test: 'vitest run',
        },
      }, null, 2),
      'src/refunds.ts': [
        'export async function loadRefundAuditTrail() {',
        "  return ['refund-created', 'refund-approved'];",
        '}',
        '',
      ].join('\n'),
    },
    changes: [
      {
        slug: 'refund-audit-trail',
        title: 'Refund Audit Trail',
        summary: 'Lock the refund audit pipeline once compliance picks the retention window.',
        focus: [
          'Store durable refund timeline events.',
          'Confirm the retention policy before backfill starts.',
        ],
        agent: {
          id: 'sample-agent-meridian',
          name: 'Codex',
        },
        tasks: [
          {
            id: 'T-001',
            title: 'Model refund timeline events',
            priority: 'high',
            status: 'done',
            description: 'Define the event stream needed to reconstruct a refund from request to payout.',
            startedHoursAgo: 36,
            completedHoursAgo: 24,
            updatedHoursAgo: 24,
            acceptanceCriteria: [
              { text: 'Capture request, approval, payout, and reversal events', done: true },
              { text: 'Define stable event ids for replay and export', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Confirm retention window',
            priority: 'high',
            status: 'needs_feedback',
            description: 'Choose the retention window so the export format and backfill volume can lock.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 5,
            updatedHoursAgo: 0.35,
            message: 'Need a product decision: keep refund audit events for 90 days or 1 year before backfill starts.',
            acceptanceCriteria: [
              { text: 'Summarize the storage cost delta for 90 days versus 1 year', done: true },
              { text: 'Lock the retention window with compliance', done: false },
              { text: 'Update the export schema notes with the chosen window', done: false },
            ],
          },
          {
            id: 'T-003',
            title: 'Emit signed export events',
            priority: 'medium',
            status: 'pending',
            description: 'Emit the export-ready audit event payload once the retention policy is fixed.',
            dependsOnAll: ['T-002'],
            updatedHoursAgo: 2.5,
            acceptanceCriteria: [
              { text: 'Sign the export batch with the service key', done: false },
              { text: 'Attach actor and reason fields to each refund event', done: false },
            ],
          },
          {
            id: 'T-004',
            title: 'Backfill legacy refunds',
            priority: 'low',
            status: 'pending',
            description: 'Replay the recent refund history into the new audit timeline store.',
            dependsOnAll: ['T-002'],
            updatedHoursAgo: 4,
            acceptanceCriteria: [
              { text: 'Backfill the last 30 days into the audit event store', done: false },
              { text: 'Report gaps or malformed legacy refund events', done: false },
            ],
          },
        ],
      },
      {
        slug: 'partner-rate-limits',
        title: 'Partner Rate Limits',
        summary: 'Ship adaptive partner throttling to protect shared API capacity.',
        focus: [
          'Move partner traffic onto a quota-aware limiter.',
          'Preserve a safe burst fallback for priority partners.',
        ],
        activeTaskRef: 'T-003',
        tasks: [
          {
            id: 'T-001',
            title: 'Define partner quota shapes',
            priority: 'high',
            status: 'done',
            description: 'Map each partner tier to a limit profile and review the edge cases.',
            startedHoursAgo: 26,
            completedHoursAgo: 22,
            updatedHoursAgo: 22,
            acceptanceCriteria: [
              { text: 'Define standard, premium, and emergency quota tiers', done: true },
              { text: 'Capture exceptions for internal partner traffic', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Implement Redis quota counters',
            priority: 'high',
            status: 'done',
            description: 'Back the limiter with Redis counters so partner traffic can burst safely.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 20,
            completedHoursAgo: 16,
            updatedHoursAgo: 16,
            acceptanceCriteria: [
              { text: 'Store rolling quota buckets in Redis', done: true },
              { text: 'Expire quota windows without manual cleanup', done: true },
            ],
          },
          {
            id: 'T-003',
            title: 'Add burst fallback',
            priority: 'medium',
            status: 'in_progress',
            description: 'Allow a short burst path for premium partners before the hard rate limit closes.',
            dependsOnAll: ['T-002'],
            startedHoursAgo: 9,
            updatedHoursAgo: 3,
            acceptanceCriteria: [
              { text: 'Allow a short premium burst when quota drops below the hard floor', done: true },
              { text: 'Emit limiter telemetry for every burst grant', done: true },
              { text: 'Return a stable retry-after header when burst is denied', done: false },
            ],
          },
          {
            id: 'T-004',
            title: 'Document partner throttle playbook',
            priority: 'low',
            status: 'pending',
            description: 'Document the rate-limit override playbook for support and on-call engineers.',
            dependsOnAll: ['T-003'],
            updatedHoursAgo: 6,
            acceptanceCriteria: [
              { text: 'Document the override path for emergency partner traffic', done: false },
              { text: 'Add sample logs to the support runbook', done: false },
            ],
          },
        ],
      },
      {
        slug: 'incident-postmortems',
        title: 'Incident Postmortems',
        summary: 'Close the cleanup items from the last API incident review.',
        focus: [
          'Record the incident follow-ups and close the obvious operational gaps.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Publish incident timeline',
            priority: 'medium',
            status: 'done',
            description: 'Publish the incident timeline with links to the raw evidence and chat summaries.',
            startedHoursAgo: 80,
            completedHoursAgo: 74,
            updatedHoursAgo: 74,
            acceptanceCriteria: [
              { text: 'Publish the minute-by-minute incident timeline', done: true },
              { text: 'Link each major decision back to the evidence source', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Add pager ownership notes',
            priority: 'low',
            status: 'done',
            description: 'Clarify who owns each pager response step when a partner outage starts.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 72,
            completedHoursAgo: 66,
            updatedHoursAgo: 66,
            acceptanceCriteria: [
              { text: 'Define who owns first response and escalation updates', done: true },
              { text: 'Link the owner table in the on-call runbook', done: true },
            ],
          },
        ],
      },
      {
        slug: 'key-rotation',
        title: 'Key Rotation',
        summary: 'Backlog the next credential rotation until the current API work settles down.',
        focus: [
          'Prepare the rotation checklist and rollout windows.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Draft rotation checklist',
            priority: 'medium',
            status: 'pending',
            description: 'Write the sequence for rotating partner keys with minimal downtime.',
            updatedHoursAgo: 14,
            acceptanceCriteria: [
              { text: 'List the partner keys that rotate this quarter', done: false },
              { text: 'Document the rollback path for a failed rotation', done: false },
            ],
          },
          {
            id: 'T-002',
            title: 'Propose rollout window',
            priority: 'low',
            status: 'pending',
            description: 'Propose a safe rollout window for the next scheduled partner key rotation.',
            dependsOnAll: ['T-001'],
            updatedHoursAgo: 12,
            acceptanceCriteria: [
              { text: 'Suggest a low-risk rollout window for each region', done: false },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'Northstar Mobile',
    description: 'Mobile client workspace with active offline sync work, a blocked beta inbox, and backlog push-preference planning.',
    files: {
      'package.json': JSON.stringify({
        name: 'northstar-mobile',
        private: true,
        scripts: {
          dev: 'expo start',
          test: 'vitest run',
        },
      }, null, 2),
      'app/offline-sync.ts': [
        'export function describeSyncState() {',
        "  return 'offline queue seeded for ui samples';",
        '}',
        '',
      ].join('\n'),
    },
    changes: [
      {
        slug: 'offline-sync',
        title: 'Offline Sync',
        summary: 'Finish the last mile of queued sync recovery before the beta refresh.',
        focus: [
          'Recover cleanly after reconnect.',
          'Surface queue health in the client debug tools.',
        ],
        activeTaskRef: 'T-003',
        tasks: [
          {
            id: 'T-001',
            title: 'Define queued mutation model',
            priority: 'high',
            status: 'done',
            description: 'Define how queued mutations survive app restarts and replay in order.',
            startedHoursAgo: 34,
            completedHoursAgo: 28,
            updatedHoursAgo: 28,
            acceptanceCriteria: [
              { text: 'Persist queued mutations with a replay order key', done: true },
              { text: 'Capture conflict metadata for later reconciliation', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Build reconnect replay engine',
            priority: 'high',
            status: 'done',
            description: 'Replay queued mutations in order once the device comes back online.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 26,
            completedHoursAgo: 20,
            updatedHoursAgo: 20,
            acceptanceCriteria: [
              { text: 'Replay queued work in the recorded mutation order', done: true },
              { text: 'Short-circuit replay when auth is stale', done: true },
            ],
          },
          {
            id: 'T-003',
            title: 'Add conflict resolution banner',
            priority: 'medium',
            status: 'in_progress',
            description: 'Explain what happened when queued work conflicts with newer server state.',
            dependsOnAll: ['T-002'],
            startedHoursAgo: 6,
            updatedHoursAgo: 0.75,
            acceptanceCriteria: [
              { text: 'Show conflict summaries when replay diverges from server state', done: true },
              { text: 'Let the user retry or discard a conflicted mutation', done: false },
              { text: 'Record conflict frequency in the beta analytics stream', done: false },
            ],
          },
          {
            id: 'T-004',
            title: 'Expose queue health diagnostics',
            priority: 'low',
            status: 'pending',
            description: 'Expose a lightweight queue health panel in the debug menu for beta support.',
            dependsOnAny: ['T-002', 'T-003'],
            updatedHoursAgo: 4.2,
            acceptanceCriteria: [
              { text: 'Show queued count, last replay time, and last error summary', done: false },
              { text: 'Allow support to export a short queue health snapshot', done: false },
            ],
          },
        ],
      },
      {
        slug: 'beta-feedback-inbox',
        title: 'Beta Feedback Inbox',
        summary: 'Block the new beta inbox until legal signs off on the stored feedback copy.',
        focus: [
          'Sort beta feedback into a reviewable inbox once legal approves the wording.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Draft inbox grouping rules',
            priority: 'medium',
            status: 'done',
            description: 'Draft the grouping rules for crash, sync, and usability feedback.',
            startedHoursAgo: 18,
            completedHoursAgo: 14,
            updatedHoursAgo: 14,
            acceptanceCriteria: [
              { text: 'Define the primary beta feedback buckets', done: true },
              { text: 'Document how duplicate reports collapse together', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Approve stored feedback copy',
            priority: 'high',
            status: 'blocked',
            description: 'Hold the inbox rollout until legal approves the stored beta feedback disclaimer.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 4.5,
            updatedHoursAgo: 1.1,
            reason: 'Blocked on legal sign-off for the stored beta feedback disclaimer copy.',
            acceptanceCriteria: [
              { text: 'Review the stored beta feedback disclaimer with legal', done: false },
              { text: 'Apply the final approved copy to the inbox intro', done: false },
            ],
          },
          {
            id: 'T-003',
            title: 'Route beta feedback to triage',
            priority: 'low',
            status: 'pending',
            description: 'Route new beta feedback items into a shared triage queue once approval lands.',
            dependsOnAll: ['T-002'],
            updatedHoursAgo: 2.9,
            acceptanceCriteria: [
              { text: 'Create the shared beta triage queue', done: false },
              { text: 'Attach platform and app version metadata to each inbox item', done: false },
            ],
          },
        ],
      },
      {
        slug: 'push-preferences',
        title: 'Push Preferences',
        summary: 'Leave notification preference planning in backlog until offline sync lands.',
        focus: [
          'Plan the preference surface and do-not-disturb rules.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Map notification categories',
            priority: 'medium',
            status: 'pending',
            description: 'List the categories that will appear in the mobile push preference center.',
            updatedHoursAgo: 10,
            acceptanceCriteria: [
              { text: 'List transactional, reminder, and marketing notification categories', done: false },
              { text: 'Note which categories cannot be fully disabled', done: false },
            ],
          },
          {
            id: 'T-002',
            title: 'Outline quiet hours rules',
            priority: 'low',
            status: 'pending',
            description: 'Describe how quiet hours should work across time zones for push preferences.',
            dependsOnAll: ['T-001'],
            updatedHoursAgo: 8.5,
            acceptanceCriteria: [
              { text: 'Document quiet-hours handling for travel across time zones', done: false },
            ],
          },
        ],
      },
      {
        slug: 'release-smoke-pass',
        title: 'Release Smoke Pass',
        summary: 'Close the lightweight release checks that were holding the last beta build.',
        focus: [
          'Keep the smoke pass lean and repeatable before beta cuts.',
        ],
        tasks: [
          {
            id: 'T-001',
            title: 'Verify fresh install flow',
            priority: 'medium',
            status: 'done',
            description: 'Run the fresh install flow on the current beta build and record the result.',
            startedHoursAgo: 52,
            completedHoursAgo: 48,
            updatedHoursAgo: 48,
            acceptanceCriteria: [
              { text: 'Verify login, onboarding, and home screen load from a clean install', done: true },
            ],
          },
          {
            id: 'T-002',
            title: 'Verify upgrade path',
            priority: 'medium',
            status: 'done',
            description: 'Check the beta upgrade path from the last public build.',
            dependsOnAll: ['T-001'],
            startedHoursAgo: 46,
            completedHoursAgo: 42,
            updatedHoursAgo: 42,
            acceptanceCriteria: [
              { text: 'Confirm data survives the upgrade to the current beta', done: true },
              { text: 'Record any migration prompts shown during launch', done: true },
            ],
          },
        ],
      },
    ],
  },
];

function seedWorkspace(workspace) {
  const workspacePath = path.join(SAMPLE_WORKSPACE_ROOT, workspace.name);
  const overlayDirName = getOverlayDirName(workspacePath);
  const projectDirName = getProjectDirName(workspacePath);
  const overlayRoot = path.join(SUPERPLAN_ROOT, overlayDirName);
  const projectRoot = path.join(SUPERPLAN_ROOT, projectDirName);

  removeDirIfPresent(workspacePath);
  removeDirIfPresent(overlayRoot);
  removeDirIfPresent(projectRoot);

  ensureDir(workspacePath);
  writeText(path.join(workspacePath, 'README.md'), buildWorkspaceReadme({
    ...workspace,
    path: workspacePath,
  }));

  for (const [relativePath, content] of Object.entries(workspace.files)) {
    writeText(path.join(workspacePath, relativePath), `${content}\n`);
  }

  for (const change of workspace.changes) {
    const changeRoot = path.join(projectRoot, 'changes', change.slug);
    writeText(path.join(changeRoot, 'plan.md'), buildPlan(change));
    writeText(path.join(changeRoot, 'tasks.md'), buildTasksIndex(change));

    for (const task of change.tasks) {
      writeText(
        path.join(changeRoot, 'tasks', `${task.id}.md`),
        buildTaskContract(change, task)
      );
    }
  }

  writeJson(path.join(projectRoot, 'runtime', 'tasks.json'), buildRuntimeTasksJson(workspace));
  writeJson(path.join(overlayRoot, 'runtime', 'overlay.json'), buildOverlaySnapshot({
    ...workspace,
    path: workspacePath,
  }));

  return {
    name: workspace.name,
    workspacePath,
    overlayRoot,
    projectRoot,
    changeCount: workspace.changes.length,
    taskCount: workspace.changes.reduce((count, change) => count + change.tasks.length, 0),
  };
}

function main() {
  ensureDir(SUPERPLAN_ROOT);
  ensureDir(SAMPLE_WORKSPACE_ROOT);

  const results = WORKSPACES.map(seedWorkspace);
  writeJson(path.join(SUPERPLAN_ROOT, 'ui-sample-index.json'), {
    generated_at: new Date().toISOString(),
    workspace_root: SAMPLE_WORKSPACE_ROOT,
    workspaces: results,
  });

  console.log(`Seeded ${results.length} Superplan UI sample workspaces.`);
  for (const result of results) {
    console.log(`- ${result.name}`);
    console.log(`  workspace: ${result.workspacePath}`);
    console.log(`  overlay:   ${result.overlayRoot}`);
    console.log(`  project:   ${result.projectRoot}`);
    console.log(`  changes:   ${result.changeCount}`);
    console.log(`  tasks:     ${result.taskCount}`);
  }
}

main();
