// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createServer, type RequestListener } from 'node:http';
import { expect, onTestFinished, test, vi } from 'vitest';
import { loadConfig } from '../../config/env.ts';
import { freePort, UNREACHABLE_DATABASE_URL } from '../../test-support.ts';
import { checkHealth, PROBE_DEFAULT_PORT, PROBE_TIMEOUT_MS, runHealthcheck } from './health-probe.ts';

// E19-S01: the container's HEALTHCHECK. The probe is tested against a real loopback server (a random port above 32768),
// so the URL, the status rule, the body rule and the timeout are what a real fetch sees.

async function serve(handler: RequestListener): Promise<number> {
  const port = await freePort();
  const server = createServer(handler);
  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', resolve);
  });
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  });
  return port;
}

const answering =
  (status: number, body: string): RequestListener =>
  (_request, response) => {
    response.writeHead(status, { 'content-type': 'application/json' }).end(body);
  };

const probe = (port: number, timeoutMs = 2000) => checkHealth({ port, fetch, timeoutMs });

test('status 200 with the body {"status":"ok"} is healthy, and the request is GET /healthz on the loopback address', async () => {
  const seen: string[] = [];
  const port = await serve((request, response) => {
    seen.push(`${request.method} ${request.url} ${request.headers.host}`);
    answering(200, '{"status":"ok"}')(request, response);
  });
  expect(await probe(port)).toBe(true);
  expect(seen).toEqual([`GET /healthz 127.0.0.1:${port}`]);
});

test('status 500 is unhealthy even with the right body', async () => {
  const port = await serve(answering(500, '{"status":"ok"}'));
  expect(await probe(port)).toBe(false);
});

test('status 204 and 503 are unhealthy: only 200 counts', async () => {
  const noContent = await serve(answering(204, ''));
  const unavailable = await serve(answering(503, '{"status":"ok"}'));
  expect([await probe(noContent), await probe(unavailable)]).toEqual([false, false]);
});

test.each([
  ['the readiness body', '{"status":"ready"}'],
  ['an extra field', '{"status":"ok","extra":true}'],
  ['a body that is not JSON', 'OK'],
  ['an empty body', ''],
  ['a JSON value that is not an object', '"ok"'],
])('status 200 with %s is unhealthy', async (_name, body) => {
  const port = await serve(answering(200, body));
  expect(await probe(port)).toBe(false);
});

test('a server that does not answer within the timeout is unhealthy', async () => {
  const port = await serve(() => undefined);
  const started = Date.now();
  expect(await probe(port, 100)).toBe(false);
  expect(Date.now() - started).toBeLessThan(2000);
});

test('a server that sends the headers and then stalls on the body is unhealthy', async () => {
  const port = await serve((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"status":');
  });
  expect(await probe(port, 100)).toBe(false);
});

test('a refused connection is unhealthy', async () => {
  expect(await probe(await freePort())).toBe(false);
});

test('the request carries an abort signal that is live at first and fires once the timeout has passed', async () => {
  const signals: (AbortSignal | null | undefined)[] = [];
  const healthy = await checkHealth({
    port: 4242,
    timeoutMs: 50,
    fetch: (_input, init) => {
      signals.push(init?.signal);
      return Promise.resolve(Response.json({ status: 'ok' }));
    },
  });
  expect(healthy).toBe(true);
  const signal = signals[0];
  expect(signal).toBeInstanceOf(AbortSignal);
  await vi.waitFor(() => {
    expect(signal?.aborted).toBe(true);
  });
});

test('the probe gives up before Docker does: its timeout is under the 3 s of the HEALTHCHECK', () => {
  expect(PROBE_TIMEOUT_MS).toBeLessThan(3000);
});

test('the default port of the probe is the default port of the server', () => {
  expect(loadConfig({ DATABASE_URL: UNREACHABLE_DATABASE_URL }).port).toBe(PROBE_DEFAULT_PORT);
});

function recording(response: () => Promise<Response>) {
  const urls: string[] = [];
  const errors: string[] = [];
  const fetchFake: typeof fetch = (input) => {
    urls.push(new Request(input).url);
    return response();
  };
  return {
    urls,
    errors,
    options: (env: Record<string, string>) => ({ env, fetch: fetchFake, err: (line: string) => errors.push(line) }),
  };
}

test('runHealthcheck exits 0 and prints nothing when the server is alive; PORT picks the port', async () => {
  const run = recording(() => Promise.resolve(Response.json({ status: 'ok' })));
  expect(await runHealthcheck(run.options({ PORT: '34567' }))).toBe(0);
  expect(run.urls).toEqual(['http://127.0.0.1:34567/healthz']);
  expect(run.errors).toEqual([]);
});

test.each([
  ['unset', {}],
  ['empty', { PORT: '' }],
])('runHealthcheck asks the default port 3000 when PORT is %s', async (_name, env) => {
  const run = recording(() => Promise.resolve(Response.json({ status: 'ok' })));
  expect(await runHealthcheck(run.options(env))).toBe(0);
  expect(run.urls).toEqual(['http://127.0.0.1:3000/healthz']);
});

test('runHealthcheck exits 1 with one line that names the address when the answer is not healthy', async () => {
  const run = recording(() => Promise.resolve(new Response('down', { status: 500 })));
  expect(await runHealthcheck(run.options({ PORT: '34567' }))).toBe(1);
  expect(run.errors).toEqual(['healthcheck: no healthy answer from http://127.0.0.1:34567/healthz']);
});

test.each([['abc'], ['70000'], ['-1'], [' 3000']])(
  'runHealthcheck exits 1 without asking anyone when PORT is %j',
  async (port) => {
    const run = recording(() => Promise.resolve(Response.json({ status: 'ok' })));
    expect(await runHealthcheck(run.options({ PORT: port }))).toBe(1);
    expect(run.urls).toEqual([]);
    expect(run.errors).toEqual(['healthcheck: PORT is not a port number']);
  },
);
