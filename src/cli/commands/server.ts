import * as http from 'http';

interface ServerCommandOptions {
  json: boolean;
  quiet: boolean;
}

interface ServerDeps {
  logger: (message: string) => void;
  onServerStarted: (server: http.Server) => void;
}

export type ServerResult =
  | {
      ok: true;
      data: {
        host: string;
        port: number;
        url: string;
        routes: string[];
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };

const DUMMY_ROUTES = [
  '/',
  '/health',
  '/api/tasks',
  '/api/echo?message=hello',
];

function getOptionValue(args: string[], optionName: string): string | undefined {
  const optionIndex = args.indexOf(optionName);
  if (optionIndex === -1) {
    return undefined;
  }

  const optionValue = args[optionIndex + 1];
  if (!optionValue || optionValue.startsWith('--')) {
    return undefined;
  }

  return optionValue;
}

function parsePort(rawPort: string | undefined): number | null {
  if (rawPort === undefined) {
    return 3000;
  }

  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
    return null;
  }

  return parsedPort;
}

function writeJson(
  response: http.ServerResponse<http.IncomingMessage>,
  statusCode: number,
  body: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function createRequestHandler(logger: (message: string) => void): http.RequestListener {
  return (request, response) => {
    const method = request.method ?? 'GET';
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');

    response.on('finish', () => {
      logger(`${method} ${requestUrl.pathname}${requestUrl.search} -> ${response.statusCode}`);
    });

    if (method !== 'GET') {
      writeJson(response, 405, {
        error: 'Method Not Allowed',
      });
      return;
    }

    if (requestUrl.pathname === '/') {
      writeJson(response, 200, {
        service: 'superplan-dummy-server',
        ok: true,
        routes: DUMMY_ROUTES,
      });
      return;
    }

    if (requestUrl.pathname === '/health') {
      writeJson(response, 200, {
        ok: true,
        status: 'ok',
      });
      return;
    }

    if (requestUrl.pathname === '/api/tasks') {
      writeJson(response, 200, {
        tasks: [
          { id: 'demo-1', title: 'Draft the plan', status: 'pending' },
          { id: 'demo-2', title: 'Implement the server', status: 'in_progress' },
          { id: 'demo-3', title: 'Review the output', status: 'done' },
        ],
      });
      return;
    }

    if (requestUrl.pathname === '/api/echo') {
      writeJson(response, 200, {
        echoed: requestUrl.searchParams.get('message') ?? '',
      });
      return;
    }

    writeJson(response, 404, {
      error: 'Not Found',
    });
  };
}

export async function server(
  args: string[],
  options: ServerCommandOptions,
  deps: Partial<ServerDeps> = {},
): Promise<ServerResult> {
  const port = parsePort(getOptionValue(args, '--port'));
  if (port === null) {
    return {
      ok: false,
      error: {
        code: 'INVALID_PORT',
        message: 'Port must be an integer between 0 and 65535',
        retryable: false,
      },
    };
  }

  const host = getOptionValue(args, '--host') ?? '127.0.0.1';
  const logger = deps.logger ?? (options.quiet ? () => {} : (message: string) => {
    console.error(`[server] ${message}`);
  });
  const onServerStarted = deps.onServerStarted ?? (() => {});

  const httpServer = http.createServer(createRequestHandler(logger));

  return await new Promise(resolve => {
    httpServer.once('error', error => {
      resolve({
        ok: false,
        error: {
          code: 'SERVER_START_FAILED',
          message: error.message,
          retryable: true,
        },
      });
    });

    httpServer.listen(port, host, () => {
      const address = httpServer.address();
      if (!address || typeof address === 'string') {
        resolve({
          ok: false,
          error: {
            code: 'SERVER_ADDRESS_UNAVAILABLE',
            message: 'Unable to determine server address',
            retryable: true,
          },
        });
        return;
      }

      const serverUrl = `http://${host}:${address.port}`;
      logger(`Server listening on ${serverUrl}`);
      onServerStarted(httpServer);

      resolve({
        ok: true,
        data: {
          host,
          port: address.port,
          url: serverUrl,
          routes: DUMMY_ROUTES,
        },
      });
    });
  });
}
