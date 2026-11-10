// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { healthResponseSchema } from '../../../shared/health.ts';
import { portField } from '../../config/env-fields.ts';

// The container's HEALTHCHECK (E19-S01): `node dist/server/healthcheck.js` asks the server in the same container whether it
// serves requests. Liveness (`/healthz`) on purpose: it touches no dependency, so a database outage does not mark the
// container unhealthy and does not trigger a restart; load balancers use `/readyz`.

/**
 * What `PORT` means when it is unset: the server's own default (a test pins that it is the schema's).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const PROBE_DEFAULT_PORT = 3000;

/**
 * Docker's HEALTHCHECK timeout is 3 s (Dockerfile); the probe gives up a little before it.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const PROBE_TIMEOUT_MS = 2500;

/** @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode). */
export interface HealthCheckOptions {
  /** The port the server listens on inside this container. */
  readonly port: number;
  readonly fetch: typeof fetch;
  /** Milliseconds the whole exchange, body included, may take. */
  readonly timeoutMs: number;
}

/** The body the liveness route answers with, and nothing else: an extra field is not the route we know. */
const strictHealthResponse = healthResponseSchema.strict();

/**
 * True when `GET http://127.0.0.1:<port>/healthz` answers 200 with the body `{"status":"ok"}` within the timeout. Any other
 * outcome (another status, another body, a refused connection, a timeout) is false; the reason is not reported, because the
 * only consumer is Docker, which wants an exit code.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode); the entry calls {@link runHealthcheck}.
 */
export async function checkHealth(options: HealthCheckOptions): Promise<boolean> {
  try {
    const response = await options.fetch(`http://127.0.0.1:${options.port}/healthz`, {
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (response.status !== 200) {
      return false;
    }
    return strictHealthResponse.safeParse(await response.json()).success;
  } catch {
    return false;
  }
}

/** The port to ask: `PORT` as the server reads it, or its default when unset or empty. Undefined when `PORT` is not a port. */
function probePort(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const value = env['PORT'];
  if (value === undefined || value === '') {
    return PROBE_DEFAULT_PORT;
  }
  const parsed = portField().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export interface RunHealthcheckOptions {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof fetch;
  /** Where the one line about an unhealthy answer goes (Docker keeps the first 4 KiB of it in `docker inspect`). */
  readonly err: (line: string) => void;
}

/** The process exit code of the healthcheck: 0 when the server is alive, 1 otherwise. Prints nothing when it is. */
export async function runHealthcheck(options: RunHealthcheckOptions): Promise<0 | 1> {
  const port = probePort(options.env);
  if (port === undefined) {
    options.err('healthcheck: PORT is not a port number');
    return 1;
  }
  if (await checkHealth({ port, fetch: options.fetch, timeoutMs: PROBE_TIMEOUT_MS })) {
    return 0;
  }
  options.err(`healthcheck: no healthy answer from http://127.0.0.1:${port}/healthz`);
  return 1;
}
