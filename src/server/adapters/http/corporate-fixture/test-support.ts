// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { LightMyRequestResponse } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { expect } from 'vitest';
import { z } from 'zod';
import {
  CORPORATE_AGREEMENT_PATH,
  CORPORATE_AGREEMENTS_PATH,
  CORPORATE_DOCUMENT_PATH,
  type CorporateAgreementCreated,
  corporateAgreementCreatedSchema,
  INSTALLATION_CORPORATE_AGREEMENTS_PATH,
  REPOSITORY_CORPORATE_DOCUMENT_PATH,
} from '../../../../shared/corporate.ts';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import type { VerifiedEmail } from '../../../../shared/verified-email.ts';
import { type CorporateDocument, publishCorporateDocument } from '../../db/corporate-fixture/test-support.ts';
import type { Database } from '../../db/schema.ts';
import { CORPORATE_TABLES, type TenantWorld } from '../../db/tenant-fixture/test-support.ts';
import { publishVersion, sha256 } from '../../db/test-support.ts';
import { matrixWorld } from '../cross-tenant-runner/test-support.ts';

// The world of the tests of corporate signing (E21-S02): the two tenants and five people of the cross-tenant matrix on the real app,
// where the plain repository of each tenant is enabled and has a corporate CLA document at version 1.0 (the document of
// `publishCorporateDocument`). People who sign are made by `signerWith`: logged in, with the verified addresses GitHub would have
// reported. The request is the one the sign page sends: JSON, the session cookie, the app's own `Origin` and the CSRF token.

/** A person with a session, as the authentication world makes one. */
export type Signer = Awaited<ReturnType<MatrixWorldOf['login']>>;

type MatrixWorldOf = Awaited<ReturnType<typeof matrixWorld>>;

/** The one verified address most people of the tests have. */
export const ADA_EMAIL: VerifiedEmail = { email: 'ada@example.org', primary: true };

/** The GitHub id of the person who signs for the company in most tests. */
export const ADA_ID = 1234;

/** A tenant of the matrix world and the corporate document its plain repository has. */
export interface CorporateSide {
  readonly tenant: TenantWorld;
  readonly document: CorporateDocument;
}

/** Gives the plain repository of `tenant` enforcement and a corporate CLA document at version 1.0. */
async function enableCorporate(db: Kysely<Database>, tenant: TenantWorld): Promise<CorporateSide> {
  const document = await publishCorporateDocument(db, tenant);
  await db
    .updateTable('repositories')
    .set({ enabled: true, corporate_document_id: document.documentId })
    .where('id', '=', tenant.plain.repositoryId)
    .execute();
  return { tenant, document };
}

/** The matrix world with the corporate CLA of both tenants (`c1`, `c2`) and Ada (GitHub id 1234) logged in with {@link ADA_EMAIL}. */
export async function corporateWorld(
  env: Readonly<Record<string, string>> = {},
  app: Parameters<typeof matrixWorld>[1] = {},
) {
  const world = await matrixWorld(env, app);
  const c1 = await enableCorporate(world.db, world.t1);
  const c2 = await enableCorporate(world.db, world.t2);
  const ada = await signerWith(world, ADA_ID);
  return { ...world, c1, c2, ada };
}

export type CorporateWorld = Awaited<ReturnType<typeof corporateWorld>>;

/** Logs `githubId` in with the verified addresses GitHub would have reported at login (the default is {@link ADA_EMAIL}). */
export async function signerWith(
  world: Pick<CorporateWorld, 'login' | 'db'>,
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

/** A valid signing request for the plain repository of `side`, with the fields in `overrides` replaced. */
export function bodyFor(side: CorporateSide, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    githubRepoId: side.tenant.plain.githubRepoId,
    versionId: side.document.versionId,
    contentSha256: side.document.contentSha256,
    companyName: 'Acme GmbH',
    signatoryTitle: 'Chief Legal Officer',
    typedName: 'Ada Lovelace',
    authorityConfirmed: true,
    ...overrides,
  };
}

/** The signing request as the page sends it: JSON, with the session cookie, the `Origin` and the CSRF token of `who`. */
export function postAgreement(world: CorporateWorld, who: Signer, body: unknown): Promise<LightMyRequestResponse> {
  return world.app.inject({
    method: 'POST',
    url: CORPORATE_AGREEMENTS_PATH,
    headers: { ...who.headers, 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

/** A read as `who` (the session cookie only), or as nobody (`null`). */
export function getAs(world: CorporateWorld, who: Signer | null, url: string): Promise<LightMyRequestResponse> {
  return world.app.inject({ method: 'GET', url, headers: who === null ? {} : { cookie: who.cookie } });
}

/** The path of the corporate CLA of the repository GitHub knows as `githubRepoId`. */
export const documentUrl = (githubRepoId: number | string): string =>
  CORPORATE_DOCUMENT_PATH.replace(':githubRepoId', String(githubRepoId));

/** The path of the agreement `agreementId`. */
export const agreementUrl = (agreementId: number | string): string =>
  CORPORATE_AGREEMENT_PATH.replace(':agreementId', String(agreementId));

/** The path of the agreements of the tenant `installationId`, with `query` (with its `?`) after it. */
export const tenantListUrl = (installationId: number | string, query = ''): string =>
  `${INSTALLATION_CORPORATE_AGREEMENTS_PATH.replace(':installationId', String(installationId))}${query}`;

/** The path that chooses the corporate CLA of the repository `repositoryId` of the tenant `installationId`. */
export const choiceUrl = (installationId: number | string, repositoryId: number | string): string =>
  REPOSITORY_CORPORATE_DOCUMENT_PATH.replace(':installationId', String(installationId)).replace(
    ':repositoryId',
    String(repositoryId),
  );

/** The `201` answer, parsed with the shared schema so that a body of another shape fails here. */
export function createdOf(response: {
  statusCode: number;
  json: () => unknown;
}): CorporateAgreementCreated['agreement'] {
  expect(response.statusCode).toBe(201);
  return corporateAgreementCreatedSchema.parse(response.json()).agreement;
}

/** The status and the `error.code` of an error answer. */
export function failureOf(response: { statusCode: number; json: () => unknown }): [number, string] {
  return [response.statusCode, errorResponseSchema.parse(response.json()).error.code];
}

/** The `error.details` of an error answer, or `undefined`. */
export function detailsOf(response: { json: () => unknown }): unknown {
  return errorResponseSchema.parse(response.json()).error.details;
}

/** The body of an error answer without its request id, which is the one thing that differs between two denials. */
export function withoutRequestId(response: { body: string }): string {
  return response.body.replace(/"requestId":"[^"]*"/u, '');
}

/** Signs for the company as `who` and answers the agreement; a status other than `201` fails the test. */
export async function signAs(
  world: CorporateWorld,
  who: Signer,
  side: CorporateSide,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return createdOf(await postAgreement(world, who, bodyFor(side, overrides)));
}

/** How many rows each table a signing writes to holds, and how many audit rows `corporate_agreement.signed` there are. */
export async function writtenRows(db: Kysely<Database>) {
  const count = async (table: Parameters<Kysely<Database>['selectFrom']>[0] & keyof Database) =>
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
    .where('action', '=', 'corporate_agreement.signed')
    .executeTakeFirstOrThrow();
  return {
    signatures: await count('signatures'),
    signerPii: await count('signer_pii'),
    agreements: await count('corporate_agreements'),
    agreementPii: await count('corporate_agreement_pii'),
    approvals: await count('corporate_approvals'),
    approvalPii: await count('corporate_approval_pii'),
    audit: Number(audit.n),
  };
}

/** The difference `writtenRows` shows between two moments: how many rows each table gained. */
function gained(after: Awaited<ReturnType<typeof writtenRows>>, before: Awaited<ReturnType<typeof writtenRows>>) {
  return {
    signatures: after.signatures - before.signatures,
    signerPii: after.signerPii - before.signerPii,
    agreements: after.agreements - before.agreements,
    agreementPii: after.agreementPii - before.agreementPii,
    approvals: after.approvals - before.approvals,
    approvalPii: after.approvalPii - before.approvalPii,
    audit: after.audit - before.audit,
  };
}

/** What a signing adds to the seven counts of `writtenRows`: one row each. */
export const ONE_AGREEMENT = {
  signatures: 1,
  signerPii: 1,
  agreements: 1,
  agreementPii: 1,
  approvals: 1,
  approvalPii: 1,
  audit: 1,
} as const;

/** What a request that writes nothing adds. */
export const NOTHING_WRITTEN = {
  signatures: 0,
  signerPii: 0,
  agreements: 0,
  agreementPii: 0,
  approvals: 0,
  approvalPii: 0,
  audit: 0,
} as const;

/** Notes the counts of `writtenRows` now; the function it answers gives the rows gained since (the matrix world starts with rows of its own). */
export async function watchRows(db: Kysely<Database>) {
  const before = await writtenRows(db);
  return async () => gained(await writtenRows(db), before);
}

/** The agreement `created` as the helpers of the schema tests see it, for the approvals they add past the routes. */
export function signedOf(side: CorporateSide, who: Signer, created: { id: number; signatureId: number }) {
  return {
    tenant: side.tenant,
    person: { userId: who.userId, githubId: who.githubId },
    signatureId: created.signatureId,
    agreementId: created.id,
  };
}

/** Publishes version `major`.0 of the corporate document of `side` and points the document at it. Answers the version a request names. */
export async function publishMajor(world: CorporateWorld, side: CorporateSide, major: number) {
  const text = `Corporate terms, major ${major}`;
  const version = await publishVersion(world.db, side.document.documentId, side.tenant.publisherId, {
    major,
    minor: 0,
    text,
  });
  await world.db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', side.document.documentId)
    .execute();
  return { versionId: version.id, contentSha256: sha256(text) };
}

/** Stores a corporate document of tenant 1, past the routes, with no version: installation-wide, or scoped to `repositoryId`. */
export async function storeCorporateDocument(
  world: CorporateWorld,
  spec: { readonly name: string; readonly repositoryId?: number },
): Promise<number> {
  const row = await world.db
    .insertInto('cla_documents')
    .values({
      installation_id: world.t1.installationId,
      repository_id: spec.repositoryId ?? null,
      name: spec.name,
      kind: 'corporate',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

const checksumRow = z.object({ n: z.number(), checksum: z.string() });

/** The number of rows and a hash of all of them for each table of the corporate CLA: two equal results mean nothing in between changed. */
export async function corporateChecksums(db: Kysely<Database>) {
  const entries = await Promise.all(
    CORPORATE_TABLES.map(async (table) => {
      const { rows } = await sql`
        select count(*)::int as n, md5(coalesce(string_agg(t::text, '|' order by t::text), '')) as checksum
        from ${sql.table(table)} as t`.execute(db);
      return [table, checksumRow.parse(rows[0])] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** `expect.any` and `expect.stringMatching` are typed `any`; as `unknown` they can sit in an object literal. */
export const ANY_NUMBER: unknown = expect.any(Number);
export const ANY_STRING: unknown = expect.any(String);
/** An instant as `toISOString` writes it: UTC, ending in `Z`. */
export const UTC_INSTANT: unknown = expect.stringMatching(/Z$/u);
