const test = require('node:test');
const assert = require('node:assert/strict');

const { loadDistModule } = require('./helpers.cjs');

test('server starts a dummy HTTP server with predictable routes and logs requests', async () => {
  const logs = [];
  let startedServer = null;

  const { server } = loadDistModule('cli/commands/server.js');
  const result = await server(['--port', '0'], { json: true, quiet: false }, {
    logger: message => {
      logs.push(message);
    },
    onServerStarted: httpServer => {
      startedServer = httpServer;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.data.port, 'number');
  assert.ok(result.data.port > 0);
  assert.equal(result.data.host, '127.0.0.1');
  assert.deepEqual(result.data.routes, [
    '/',
    '/health',
    '/api/tasks',
    '/api/echo?message=hello',
  ]);
  assert.ok(startedServer);

  const rootResponse = await fetch(`${result.data.url}/`);
  assert.equal(rootResponse.status, 200);
  assert.deepEqual(await rootResponse.json(), {
    service: 'superplan-dummy-server',
    ok: true,
    routes: result.data.routes,
  });

  const healthResponse = await fetch(`${result.data.url}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), {
    ok: true,
    status: 'ok',
  });

  const tasksResponse = await fetch(`${result.data.url}/api/tasks`);
  assert.equal(tasksResponse.status, 200);
  assert.deepEqual(await tasksResponse.json(), {
    tasks: [
      { id: 'demo-1', title: 'Draft the plan', status: 'pending' },
      { id: 'demo-2', title: 'Implement the server', status: 'in_progress' },
      { id: 'demo-3', title: 'Review the output', status: 'done' },
    ],
  });

  const echoResponse = await fetch(`${result.data.url}/api/echo?message=hello`);
  assert.equal(echoResponse.status, 200);
  assert.deepEqual(await echoResponse.json(), {
    echoed: 'hello',
  });

  const missingResponse = await fetch(`${result.data.url}/missing`);
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), {
    error: 'Not Found',
  });

  assert.equal(logs.some(message => message.includes('Server listening on')), true);
  assert.equal(logs.some(message => message.includes('GET /health -> 200')), true);
  assert.equal(logs.some(message => message.includes('GET /missing -> 404')), true);

  await new Promise((resolve, reject) => {
    startedServer.close(error => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
});
