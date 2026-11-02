// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../shared/github-id.ts';
import type { SessionStore } from '../adapters/db/sessions.ts';
import type { RoleCache } from './role-cache.ts';

// The consumer of the `revoke-user-sessions` job (E10-S07). A person who revokes the App's authorization on GitHub has
// said "no more"; every login of theirs on this instance ends at once. The job is enqueued by the webhook intake
// (E06-S04) with the numeric GitHub id of the person and nothing else; the queue keeps it until a worker runs this
// handler. A session says nothing about tenants, so the deletion covers the whole instance and the event carries no
// installation to scope it by.

/** The queue and envelope `type` of the job. */
export const REVOKE_SESSIONS_JOB = 'revoke-user-sessions';

/**
 * The envelope of the job: the type, the id of the webhook delivery it came from (kept for the delivery bookkeeping of
 * E07-S03) and the identity. A field the schema does not know is dropped, not refused: a revocation is a security
 * action and must not be lost to an extra key; the identity itself is held to a positive safe integer.
 */
export const revokeUserSessionsPayloadSchema = z.object({
  type: z.literal(REVOKE_SESSIONS_JOB),
  deliveryId: z.string().min(1).max(100).optional(),
  githubUserId: githubIdSchema,
});

export type RevokeUserSessionsPayload = z.infer<typeof revokeUserSessionsPayloadSchema>;

/**
 * The job data is not a valid envelope. Retrying cannot repair it, so the worker pipeline fails the job at once
 * (`job_payload_invalid`, E07-S03). The message is fixed text: nothing of the payload reaches it.
 */
export class InvalidJobPayloadError extends Error {
  override readonly name = 'InvalidJobPayloadError';
  readonly code = 'job_payload_invalid';

  constructor() {
    super('job_payload_invalid');
  }
}

/** The part of a logger the handler uses: an info line with plain fields. */
interface HandlerLog {
  info(fields: object, message: string): void;
}

export interface RevokeUserSessionsDeps {
  readonly sessions: Pick<SessionStore, 'removeAllOfGithubId'>;
  /** The cache of the roles GitHub reported (E11-S04), the one the application's guards read: the same instance, in this process. */
  readonly roles: Pick<RoleCache, 'invalidateViewer'>;
  readonly log: HandlerLog;
}

/**
 * The handler of `revoke-user-sessions`. It validates the envelope, deletes every session of the person, forgets the roles
 * cached for them (E11-S04: the person said "no more", so nothing GitHub said earlier is served on) and logs the numeric
 * id and the count, never a login or a name. The job is idempotent: running it again, or for a person with no
 * session, deletes nothing and succeeds with count 0. An error from the database is not caught: the job fails, the queue
 * retries it and, after the limit, dead-letters it (E07-S05). Resolves to the count.
 */
export function createRevokeUserSessionsHandler(deps: RevokeUserSessionsDeps): (data: unknown) => Promise<number> {
  return async (data) => {
    const payload = revokeUserSessionsPayloadSchema.safeParse(data);
    if (!payload.success) {
      throw new InvalidJobPayloadError();
    }
    const { githubUserId } = payload.data;
    const revoked = await deps.sessions.removeAllOfGithubId(githubUserId);
    deps.roles.invalidateViewer(githubUserId);
    deps.log.info({ githubUserId, revoked }, 'auth.sessions_revoked');
    return revoked;
  };
}
