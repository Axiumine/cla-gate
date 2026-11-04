// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { LightMyRequestResponse } from 'fastify';
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import { type SignContextResponse, signContextResponseSchema } from '../../../../shared/sign-context.ts';
import type { VerifiedEmail } from '../../../../shared/verified-email.ts';
import type { VersionRef } from '../../../services/export/export-fixture/test-support.ts';
import type { Database } from '../../db/schema.ts';
import { seedTenant, sha256, type Tenant } from '../../db/test-support.ts';
import { type AuthWorld, authWorld } from '../auth-fixture/test-support.ts';

// The world of the tests of the sign page context (E13-S02): the real app on a migrated PGlite with two tenants made by
// `seedTenant(db, 1)` and `seedTenant(db, 2)`. Each tenant is admitted and its repository `org-<n>/repo` (GitHub id
// `<n> * 9000`) enforces the tenant's document `Individual CLA`, whose active version is 1.0. People log in with `login`;
// nobody has a verified e-mail address unless `loginWithEmails` gives them some.

/** The GitHub id of the repository of tenant `n`: the number `seedTenant` gives it. */
export const repoIdOf = (n: number): number => n * 9000;

/** What a session sends: the cookie. */
export interface Session {
  readonly cookie: string;
  readonly userId: number;
  readonly sessionId: number;
  readonly githubId: number;
}

export interface SignWorld extends AuthWorld {
  readonly t1: Tenant;
  readonly t2: Tenant;
  /** The sign context as the session asks for it; nobody (`null`) sends no cookie. */
  readonly ask: (
    session: Session | null,
    githubRepoId: number | string,
    query?: string,
  ) => Promise<LightMyRequestResponse>;
}

/** Admits the tenant's installation and makes its repository enforce the tenant's document. */
export async function serveTenant(db: Kysely<Database>, tenant: Tenant): Promise<void> {
  await db
    .updateTable('installations')
    .set({ admission_status: 'admitted', admission_reason: null })
    .where('id', '=', tenant.installationId)
    .execute();
  await db
    .updateTable('repositories')
    .set({ cla_document_id: tenant.documentId })
    .where('id', '=', tenant.repositoryId)
    .execute();
}

/** The sign context world. `github` sets the options of the app the authentication world takes (the queue, for one). */
export async function signWorld(
  env: Readonly<Record<string, string>> = {},
  github: Parameters<typeof authWorld>[1] = {},
): Promise<SignWorld> {
  const world = await authWorld(env, github);
  const t1 = await seedTenant(world.db, 1);
  const t2 = await seedTenant(world.db, 2);
  await Promise.all([serveTenant(world.db, t1), serveTenant(world.db, t2)]);
  const ask: SignWorld['ask'] = (session, githubRepoId, query = '') =>
    world.app.inject({
      method: 'GET',
      url: `/api/sign/${githubRepoId}${query}`,
      headers: session === null ? {} : { cookie: session.cookie },
    });
  return { ...world, t1, t2, ask };
}

/** Logs `githubId` in with the verified addresses GitHub would have reported at login. */
export async function loginWithEmails(
  world: SignWorld,
  githubId: number,
  emails: readonly VerifiedEmail[],
): Promise<Session> {
  const session = await world.login(githubId);
  await world.db
    .updateTable('sessions')
    .set({ verified_emails: JSON.stringify(emails) })
    .where('id', '=', session.sessionId)
    .execute();
  return session;
}

/** The body of a `200` answer, parsed with the shared schema so that a body of another shape fails here. */
export function contextOf(response: { statusCode: number; json: () => unknown }): SignContextResponse {
  expect(response.statusCode).toBe(200);
  return signContextResponseSchema.parse(response.json());
}

/** The `error.code` of an error answer. */
export function errorCodeOf(response: { json: () => unknown }): string {
  return errorResponseSchema.parse(response.json()).error.code;
}

/** The body of an error answer without its request id, which is the one thing that differs between two denials. */
export function withoutRequestId(response: { body: string }): string {
  return response.body.replace(/"requestId":"[^"]*"/u, '');
}

/** What a published version is made of. */
interface VersionSpec {
  readonly major: number;
  readonly minor: number;
  readonly text: string;
  readonly rationale?: string;
}

/** Publishes a version of the document and points the document at it; answers what a seeded signature names (`seedSignatures`). */
export async function publishAndPoint(db: Kysely<Database>, tenant: Tenant, spec: VersionSpec): Promise<VersionRef> {
  const version = await db
    .insertInto('cla_versions')
    .values({
      document_id: tenant.documentId,
      major: spec.major,
      minor: spec.minor,
      content_md: spec.text,
      content_sha256: sha256(spec.text),
      published_by: tenant.publisherId,
      rationale: spec.rationale ?? 'test',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', tenant.documentId)
    .execute();
  return { id: version.id, major: spec.major, sha256: sha256(spec.text) };
}
