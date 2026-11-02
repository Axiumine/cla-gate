// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { EventEmitter, once } from 'node:events';
import net from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';
import type { DestinationStream } from 'pino';
import { onTestFinished } from 'vitest';
import { z } from 'zod';
import { pickSystemFreePort } from '../../scripts/ci/lib/ports.ts';
import { openPgliteDatabase } from './adapters/db/pglite.ts';
import type { Database } from './adapters/db/schema.ts';
import { createLogger } from './adapters/http/logger.ts';
import { buildApp } from './app.ts';
import { type AppConfig, loadConfig } from './config/env.ts';
import type { Clock } from './services/ports/clock.ts';
import type { JobEnqueuer } from './services/ports/jobs.ts';

const LogLine = z.record(z.string(), z.unknown());

/** The part of `process` the server touches (signals and the exit code), for the tests of boot() and closeOnSignals(). */
export class FakeProcess extends EventEmitter {
  exitCode: number | string | null | undefined;
}

export const UNREACHABLE_DATABASE_URL = 'postgres://user:pw@127.0.0.1:1/db';

/**
 * A random free port from 32769 to 60999 on 127.0.0.1, chosen by us as docs/ci-runners.md (Ports) requires. Tests that
 * listen use this and never port 0, which asks the kernel for a port from its ephemeral range (a host sysctl).
 */
export const freePort = pickSystemFreePort;

/** A pino destination that keeps what was written, so tests can assert on log lines (and on their absence). */
export interface LogCapture {
  readonly destination: DestinationStream;
  /** The raw text of everything logged so far. */
  text(): string;
  /** Every log line, parsed. */
  lines(): Record<string, unknown>[];
}

export function captureLogs(): LogCapture {
  const chunks: string[] = [];
  return {
    destination: { write: (chunk: string) => chunks.push(chunk) },
    text: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => LogLine.parse(JSON.parse(line))),
  };
}

export function testConfig(env: Readonly<Record<string, string>> = {}): AppConfig {
  return loadConfig({ DATABASE_URL: UNREACHABLE_DATABASE_URL, LOG_LEVEL: 'info', ...env });
}

export interface TestApp {
  readonly app: FastifyInstance;
  readonly logs: LogCapture;
  readonly db: Kysely<Database>;
}

export interface TestAppOptions {
  readonly env?: Readonly<Record<string, string>>;
  /** Defaults to a fresh PGlite. */
  readonly db?: Kysely<Database>;
  readonly readinessTimeoutMs?: number;
  /** Defaults to the wall clock. */
  readonly clock?: Clock;
  /** Where the webhook route sends a job (E06-S06). Defaults to the app's own, which fails every send. */
  readonly enqueuer?: JobEnqueuer;
  /** Where the webhook route answers `503` `webhook_timeout` (E06-S07). Defaults to the app's own, 8 seconds. */
  readonly webhookDeadlineMs?: number;
}

/** The real app on a database, logging into memory, closed after the test. Add routes before the first request. */
export async function testApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = testConfig(options.env);
  const logs = captureLogs();
  const db = options.db ?? (await openPgliteDatabase());
  const app = await buildApp({
    config,
    db,
    logger: createLogger(config, logs.destination),
    ...(options.readinessTimeoutMs === undefined ? {} : { readinessTimeoutMs: options.readinessTimeoutMs }),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.enqueuer === undefined ? {} : { enqueuer: options.enqueuer }),
    ...(options.webhookDeadlineMs === undefined ? {} : { webhookDeadlineMs: options.webhookDeadlineMs }),
  });
  onTestFinished(async () => {
    await app.close();
  });
  return { app, logs, db };
}

/** A TCP server that accepts connections and never answers: what a database behind a black-holing firewall looks like. */
export async function silentPostgres(): Promise<{ url: string; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('error', console.error);
  });
  const port = await freePort();
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `postgres://user:pw@127.0.0.1:${port}/db`,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

export interface RawResponse {
  /** For example `HTTP/1.1 400 Bad Request`. */
  readonly statusLine: string;
  /** Header names are lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Sends `text` over a plain TCP connection to `address` (`http://host:port`) and reads until the server hangs up. */
export async function sendRaw(address: string, text: string): Promise<RawResponse> {
  const { hostname, port } = new URL(address);
  const socket = net.connect({ host: hostname, port: Number(port) });
  const chunks: Buffer[] = [];
  socket.on('data', (chunk: Buffer) => chunks.push(chunk));
  // `once` rejects when the socket emits 'error' first, so a reset fails the test instead of crashing the process.
  const closed: Promise<unknown> = once(socket, 'close');
  socket.write(text);
  await closed;
  const [head = '', ...bodyParts] = Buffer.concat(chunks).toString('utf8').split('\r\n\r\n');
  const [statusLine = '', ...fields] = head.split('\r\n');
  const headers = Object.fromEntries(
    fields.map((field) => [
      field.slice(0, field.indexOf(':')).toLowerCase(),
      field.slice(field.indexOf(':') + 1).trim(),
    ]),
  );
  return { statusLine, headers, body: bodyParts.join('\r\n\r\n') };
}
