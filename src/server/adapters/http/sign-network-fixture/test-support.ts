// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import Fastify, { type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import { onTestFinished } from 'vitest';
import { parseGithubId } from '../../../../shared/github-id.ts';
import { SIGN_PATH } from '../../../../shared/sign.ts';
import type { Database } from '../../db/schema.ts';
import { registerErrorHandlers } from '../errors.ts';
import { postSign, type RequestOrigin, type signingWorld } from '../sign-fixture/test-support.ts';
import { signRoutes } from '../sign-routes.ts';

// The helpers of the tests of the optional network metadata of a signing (E13-S05): a world in which the operator switched
// recording on, a way to sign from a given address with a given user agent, and a read of what `signer_pii` stored.

/** The environment of an instance whose operator switched `RECORD_NETWORK_METADATA` on. */
export const RECORDING = { RECORD_NETWORK_METADATA: 'true' } as const;

/** An address from the documentation range (RFC 5737) and a user agent: made-up values that no log line or body holds by accident. */
export const TEST_IP = '203.0.113.7';
/** A user agent no request id (hexadecimal) and no fixed log field can contain, so a search for it proves its absence. */
export const TEST_AGENT = 'zzzz-network-agent/1.0 (X11; test)';

/** The world of the sign request, with the first person logged in. */
export type SigningWorld = Awaited<ReturnType<typeof signingWorld>>;

/** Ada signs the version of tenant 1 from `from`, with the fields of `overrides` replaced; the answer is the raw response. */
export function signFrom(
  state: Pick<SigningWorld, 'world' | 'ada' | 'body'>,
  from: RequestOrigin,
  overrides?: Readonly<Record<string, unknown>>,
) {
  return postSign(state.world, state.ada, state.body(overrides), from);
}

/** What `signer_pii` stored in the two network columns, one entry per row, oldest first. */
export async function storedNetwork(db: Kysely<Database>) {
  const rows = await db.selectFrom('signer_pii').select(['ip_address', 'user_agent']).orderBy('signature_id').execute();
  return rows.map((row) => ({ ip: row.ip_address, userAgent: row.user_agent }));
}

/** The part of a request that a tripwire makes throw when it is read. */
export type Tripwire = 'ip' | 'user-agent';

/** The person of the session of `state`, as the session lookup would have set it on the request. */
function callerOf(state: SigningWorld) {
  return {
    user: {
      id: state.ada.userId,
      githubId: parseGithubId(state.ada.githubId),
      login: 'login-1234',
      name: null,
      avatarUrl: null,
    },
    sessionId: state.ada.sessionId,
    csrfSecret: 'a-made-up-session-secret',
    expiresAt: new Date('2030-01-01T00:00:00Z'),
  };
}

/** Makes reading the part of `request` that `wire` names throw; every other header still reads as it did. */
function armTripwire(request: FastifyRequest, wire: Tripwire): void {
  if (wire === 'ip') {
    Object.defineProperty(request, 'ip', {
      get(): string {
        throw new Error('request.ip was read');
      },
    });
    return;
  }
  const raw = request.raw.headers;
  const guarded = new Proxy(raw, {
    get(target, key) {
      if (key === 'user-agent') {
        throw new Error('the user-agent header was read');
      }
      const value: unknown = Reflect.get(target, key);
      return value;
    },
  });
  Object.defineProperty(request, 'headers', { get: () => guarded });
}

/**
 * The sign route on a bare application (no session lookup, no guards) whose request is a double for E13-S05: reading the part
 * `wire` names throws. The first person of `state` is the caller, and the route writes to the database of `state`. Whatever
 * the handler does not read cannot fail it, so a `201` from this application proves that the handler left that part alone.
 */
export async function tripwireApp(state: SigningWorld, record: boolean, wire: Tripwire) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandlers(app);
  app.decorateRequest('auth', null);
  app.addHook('onRequest', (request, _reply, done) => {
    request.auth = callerOf(state);
    armTripwire(request, wire);
    done();
  });
  await app.register(signRoutes, { db: state.world.db, enqueuer: state.queue, recordNetworkMetadata: record });
  onTestFinished(async () => {
    await app.close();
  });
  return {
    sign: () =>
      app.inject({
        method: 'POST',
        url: SIGN_PATH,
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(state.body()),
      }),
  };
}
