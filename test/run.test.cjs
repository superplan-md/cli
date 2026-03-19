const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadDistModule,
} = require('./helpers.cjs');

test('run notifies the pickup hook only when it actually starts a task', async () => {
  const pickedTaskIds = [];
  let callCount = 0;
  const fakeTaskFn = async (args, deps = {}) => {
    callCount += 1;

    if (callCount === 1) {
      assert.deepEqual(args, ['next']);
      return {
        ok: true,
        data: {
          task_id: 'T-901',
          status: 'ready',
        },
      };
    }

    if (callCount === 2) {
      assert.deepEqual(args, ['start', 'T-901']);
      if (deps.onTaskPicked) {
        await deps.onTaskPicked('T-901');
      }

      return {
        ok: true,
        data: {
          task_id: 'T-901',
          status: 'in_progress',
        },
      };
    }

    assert.deepEqual(args, ['next']);
    return {
      ok: true,
      data: {
        task_id: 'T-901',
        status: 'in_progress',
      },
    };
  };

  const { run } = loadDistModule('cli/commands/run.js');

  const firstRunResult = await run({
    taskFn: fakeTaskFn,
    taskCommandDeps: {
      onTaskPicked: taskId => {
        pickedTaskIds.push(taskId);
      },
    },
  });

  const secondRunResult = await run({
    taskFn: fakeTaskFn,
    taskCommandDeps: {
      onTaskPicked: taskId => {
        pickedTaskIds.push(taskId);
      },
    },
  });

  assert.equal(firstRunResult.ok, true);
  assert.equal(firstRunResult.data.action, 'start');
  assert.equal(secondRunResult.ok, true);
  assert.equal(secondRunResult.data.action, 'continue');
  assert.deepEqual(pickedTaskIds, ['T-901']);
});

test('run can start a task without any pickup hook', async () => {
  let callCount = 0;
  const fakeTaskFn = async (args) => {
    callCount += 1;
    if (callCount === 1) {
      assert.deepEqual(args, ['next']);
      return {
        ok: true,
        data: {
          task_id: 'T-902',
          status: 'ready',
        },
      };
    }

    assert.deepEqual(args, ['start', 'T-902']);
    return {
      ok: true,
      data: {
        task_id: 'T-902',
        status: 'in_progress',
      },
    };
  };

  const { run } = loadDistModule('cli/commands/run.js');

  const runResult = await run({
    taskFn: fakeTaskFn,
  });

  assert.equal(runResult.ok, true);
  assert.equal(runResult.data.action, 'start');
});
