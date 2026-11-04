// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { LightMyRequestResponse } from 'fastify';
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import { SIGN_PATH, type SignResponse, signResponseSchema } from '../../../../shared/sign.ts';
import type { VerifiedEmail } from '../../../../shared/verified-email.ts';
import { failureDetails } from '../../../domain/failure-details-fixture/test-support.ts';
import { createJobsTable, fakeEnqueuer } from '../../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import { storeFailure } from '../../../services/sign-evaluations-fixture/test-support.ts';
import type { Database } from '../../db/schema.ts';
import { publishVersion, sha256, type Tenant } from '../../db/test-support.ts';
import type { AuthWorld } from '../auth-fixture/test-support.ts';
import { publishAndPoint, repoIdOf, type SignWorld, signWorld } from '../sign-context-fixture/test-support.ts';

// The world of the tests of the sign request (E13-S04): the sign context world (two tenants whose repositories enforce an
// individual CLA at version 1.0, `org-<n>/repo` with GitHub id `<n> * 9000`) plus people who are logged in with verified
// addresses and a way to send the request the sign page sends: the session cookie, the app's own `Origin` and the CSRF token.

/** A person with a session, as the authentication world makes one. */
export type Signer = Awaited<ReturnType<AuthWorld['login']>>;

/** The one verified address most people of the tests have. */
export const ADA_EMAIL: VerifiedEmail = { email: 'ada@example.org', primary: true };

/** The name most requests carry. */
export const ADA_NAME = 'Ada Lovelace';

/** Logs `githubId` in with the verified addresses GitHub would have reported at login (the default is {@link ADA_EMAIL}). */
export async function signerWith(
  world: SignWorld,
  githubId: number,
  emails: readonly VerifiedEmail[] = [ADA_EMAIL],
): Promise<Signer> {
  const session = await world.login(githubId);
  await world.db
    .updateTable('sessions')
    .set({ verified_emails: JSON.stringify(emails) })
    .where('id', '=', session.sessionId)
    .execute();
  return session;
}

/** A valid request body for the repository of tenant `n` (its version 1.0), with the fields in `overrides` replaced. */
export function bodyFor(tenant: Tenant, n: number, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    githubRepoId: repoIdOf(n),
    prNumber: 45,
    versionId: tenant.versionId,
    contentSha256: tenant.contentSha256,
    consentTextId: 'individual-v1',
    name: ADA_NAME,
    email: ADA_EMAIL.email,
    ...overrides,
  };
}

/**
 * Where a sign request comes from (E13-S05): the address of the socket and the headers the browser adds to the ones of the page.
 * A header set to `undefined` is not sent; for `user-agent` that matters, because the test client sends its own when it is left out.
 */
export interface RequestOrigin {
  readonly remoteAddress?: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
}

/** The sign request as the page sends it: JSON, with the session cookie, the `Origin` and the CSRF token of `who`, from `from`. */
export function postSign(
  world: SignWorld,
  who: Signer,
  body: unknown,
  from: RequestOrigin = {},
): Promise<LightMyRequestResponse> {
  return world.app.inject({
    method: 'POST',
    url: SIGN_PATH,
    headers: { ...who.headers, 'content-type': 'application/json', ...from.headers },
    payload: JSON.stringify(body),
    ...(from.remoteAddress === undefined ? {} : { remoteAddress: from.remoteAddress }),
  });
}

/** `body` without its `prNumber`: a signing from the dashboard, which names no pull request (E13-S07). */
export function withoutPrNumber(body: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'prNumber'));
}

/**
 * Stores a failed evaluation of pull request `prNumber` of tenant `tenant`'s repository that lists Ada (GitHub id 1234) as uncovered,
 * last touched on `day` of June 2026: a pull request that the signing of E13-S07 turns green.
 */
export function failingForAda(world: SignWorld, tenant: 1 | 2, prNumber: number, day: number): Promise<number> {
  const { installationId, repositoryId } = tenant === 1 ? world.t1 : world.t2;
  return storeFailure(
    world.db,
    { installationId, repositoryId },
    { prNumber, details: failureDetails({ uncovered: [1234] }), updatedAt: new Date(Date.UTC(2026, 5, day)) },
  );
}

/** Stands in for the revoke route of E15: a direct update by the owner role revokes the signature `id`. */
export async function revokeSignature(world: SignWorld, id: number): Promise<void> {
  await world.db
    .updateTable('signatures')
    .set({
      revoked_at: new Date(Date.now() + 1000),
      revoked_by: world.t1.publisherId,
      revoke_reason: 'maintainer_decision',
    })
    .where('id', '=', id)
    .execute();
}

/**
 * A queue that refuses the `nth` send (counting from 1, once) after writing it, as one that loses its connection does, and sends
 * every other through `inner`. The send it refused was written on the transaction it was given, which the failure rolls back.
 */
export function refusingSend(inner: JobEnqueuer, nth: number): JobEnqueuer {
  let calls = 0;
  return {
    async enqueue(tx, job, options) {
      calls += 1;
      const outcome = await inner.enqueue(tx, job, options);
      if (calls === nth) {
        throw new Error('zzzz the queue went away');
      }
      return outcome;
    },
  };
}

/**
 * The world of the sign request: the sign context world and Ada (GitHub id 1234) logged in with {@link ADA_EMAIL}. A new signature
 * sends its evaluation jobs (E13-S07) through `queue`, which by default is the fake queue of the webhook tests: it writes into
 * the table `fake_jobs` of the world's database, on the transaction it is given, so `sentJobs(world.db)` lists what committed.
 */
export async function signingWorld(env: Readonly<Record<string, string>> = {}, queue: JobEnqueuer = fakeEnqueuer()) {
  const world = await signWorld(env, { enqueuer: queue });
  await createJobsTable(world.db);
  const ada = await signerWith(world, 1234);
  return {
    world,
    ada,
    queue,
    body: (overrides?: Readonly<Record<string, unknown>>) => bodyFor(world.t1, 1, overrides),
  };
}

/** The body of a `201` or `200` answer, parsed with the shared schema so that a body of another shape fails here. */
export function signedOf(response: { statusCode: number; json: () => unknown }, status: 200 | 201): SignResponse {
  expect(response.statusCode).toBe(status);
  return signResponseSchema.parse(response.json());
}

/** How many rows the three tables a signature is written to hold, with the audit rows of `signature.created` only. */
export async function writtenRows(db: Kysely<Database>) {
  const count = async (table: 'signatures' | 'signer_pii') =>
    Number(
      (
        await db
          .selectFrom(table)
          .select((eb) => eb.fn.countAll().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
  const audit = await db
    .selectFrom('audit_log')
    .select((eb) => eb.fn.countAll().as('n'))
    .where('action', '=', 'signature.created')
    .executeTakeFirstOrThrow();
  return { signatures: await count('signatures'), signerPii: await count('signer_pii'), audit: Number(audit.n) };
}

/** The rows a world holds before anyone signs: the two signers of `seedTenant` do not exist here, so all three are zero. */
export const NOTHING_WRITTEN = { signatures: 0, signerPii: 0, audit: 0 } as const;

/** Publishes version `major.minor` of tenant 1's document and points the document at it. */
export function publishNext(world: SignWorld, major: number, minor: number) {
  const text = `Terms ${major}.${minor}`;
  return publishAndPoint(world.db, world.t1, { major, minor, text }).then((version) => ({
    ...version,
    text,
    sha: sha256(text),
  }));
}

/**
 * Makes the repository of tenant 1 enforce a corporate document with a version 1.0 (corporate signing is E21) and answers the
 * ids a request for it names. The kind of a document never changes, so the document is a new one.
 */
export async function enforceCorporateDocument(world: SignWorld) {
  const { db, t1 } = world;
  const document = await db
    .insertInto('cla_documents')
    .values({
      installation_id: t1.installationId,
      repository_id: null,
      name: 'Corporate CLA',
      kind: 'corporate',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await publishVersion(db, document.id, t1.publisherId, {
    major: 1,
    minor: 0,
    text: 'Corporate terms',
  });
  await db.updateTable('cla_documents').set({ active_version_id: version.id }).where('id', '=', document.id).execute();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: document.id })
    .where('id', '=', t1.repositoryId)
    .execute();
  return { versionId: version.id, contentSha256: sha256('Corporate terms') };
}
