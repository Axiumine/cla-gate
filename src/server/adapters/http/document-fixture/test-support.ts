// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { z } from 'zod';
import { DOCUMENT_NAME_MAX_CODE_POINTS } from '../../../../shared/cla-name.ts';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import { HOSTILE_NAMES } from '../../../../shared/hostile-names.ts';
import type { TestAppOptions } from '../../../test-support.ts';
import { type PersonName, tenantChecksums } from '../../db/tenant-fixture/test-support.ts';
import { sha256 } from '../../db/test-support.ts';
import { matrixWorld } from '../cross-tenant-runner/test-support.ts';

// The world of the CLA documents route tests (E12-S01): the two tenants and five people of the cross-tenant matrix, on the
// real app, and the few helpers the tests share. Tenant 1 holds `Individual CLA` (installation-wide, version 1.0 active) and
// `Repository CLA` (scoped to the repository `org-1/scoped`, no version); tenant 2 holds the same two names.

export type DocumentWorld = Awaited<ReturnType<typeof matrixWorld>>;

/** The world of the tests: the matrix world, with the documents routes already part of the app. `app` sets the queue of the app (E12-S04). */
export const documentWorld = (app?: Pick<TestAppOptions, 'enqueuer'>): Promise<DocumentWorld> => matrixWorld({}, app);

/** The path of the documents of the installation `installationId` (`installations.id`). */
export const documentsPath = (installationId: number): string => `/api/installations/${installationId}/documents`;

/** The path of the draft of the document `documentId` of the installation `installationId`. */
export const draftPath = (installationId: number, documentId: number): string =>
  `${documentsPath(installationId)}/${documentId}/draft`;

/** A name for a made-up document, so a test never meets the names the world already has. */
export const nameOf = (n: number): string => `Test document ${String(n).padStart(3, '0')}`;

/** The body of a response read with `schema`, so a body of another shape fails the test here and is typed from there on. */
export function parsed<T>(response: { json: () => unknown }, schema: z.ZodType<T>): T {
  return schema.parse(response.json());
}

/** The `error.code` of an error response, parsed with the shared schema so a different shape fails here. */
export function errorCodeOf(response: { json: () => unknown }): string {
  return parsed(response, errorResponseSchema).error.code;
}

/** The body of an error response without its request id, which is the one thing that differs between two denials. */
export function withoutRequestId(response: { body: string }): string {
  return response.body.replace(/"requestId":"[^"]*"/, '');
}

const rowCount = z.object({ n: z.number() });

/** How many documents the database holds, in every tenant. */
export async function documentCount(world: DocumentWorld): Promise<number> {
  const row = await world.db
    .selectFrom('cla_documents')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  return rowCount.parse(row).n;
}

/**
 * The checksums of every tenant table but the ledger of org admins, which the guard refreshes on every call it lets in: two equal
 * results mean a call that got past the guard changed no row of any other table.
 */
export async function tablesOf(world: DocumentWorld) {
  const all = await tenantChecksums(world.db);
  return Object.fromEntries(Object.entries(all).filter(([table]) => table !== 'installation_admin_seen'));
}

/** The audit rows of one action, oldest first. */
export function auditRows(world: DocumentWorld, action: string) {
  return world.db.selectFrom('audit_log').selectAll().where('action', '=', action).orderBy('id').execute();
}

/** Creates a document as `who` and answers the response. */
export function createAs(world: DocumentWorld, who: PersonName | null, installationId: number, payload: object) {
  return world.ask(who, { method: 'POST', url: documentsPath(installationId), payload });
}

/**
 * The names of the shared hostile corpus (`src/shared/hostile-names.ts`, E09-S01) that a document may carry: every printable name
 * of it but the one of 200 code points, which is over the limit of a document name. Each is a valid document name and must come
 * back exactly as it went in, and the tests below check the count so that a name that starts to be refused cannot drop out unseen.
 */
export const HOSTILE_DOCUMENT_NAMES: readonly string[] = HOSTILE_NAMES.filter(
  (name) => Array.from(name).length <= DOCUMENT_NAME_MAX_CODE_POINTS,
);

/** Stores `count` installation-wide documents named `nameOf(first)`, `nameOf(first + 1)` and so on for a tenant, past the routes. */
export async function fillDocuments(
  world: DocumentWorld,
  installationId: number,
  count: number,
  first = 1,
): Promise<void> {
  const rows = Array.from({ length: count }, (_unused, index) => ({
    installation_id: installationId,
    repository_id: null,
    name: nameOf(first + index),
    kind: 'individual' as const,
    active_version_id: null,
  }));
  await world.db.insertInto('cla_documents').values(rows).execute();
}

/** The path of the versions of the document `documentId` of the installation `installationId`. */
export const versionsPath = (installationId: number, documentId: number): string =>
  `${documentsPath(installationId)}/${documentId}/versions`;

/** Publishes the draft of a document as `who`; `body` is sent as it is. */
export function publishAs(
  world: DocumentWorld,
  who: PersonName | null,
  target: { readonly installationId: number; readonly documentId: number },
  body: object,
) {
  return world.ask(who, { method: 'POST', url: versionsPath(target.installationId, target.documentId), payload: body });
}

/** Reads the draft of a document as `who`. */
export function readDraftAs(world: DocumentWorld, who: PersonName | null, installationId: number, documentId: number) {
  return world.ask(who, { method: 'GET', url: draftPath(installationId, documentId) });
}

/** Saves a draft as `who`: `expectedRevision` is the revision the editor read, or null when it read none. */
export function saveDraftAs(
  world: DocumentWorld,
  who: PersonName | null,
  target: { readonly installationId: number; readonly documentId: number },
  payload: object,
) {
  return world.ask(who, { method: 'PUT', url: draftPath(target.installationId, target.documentId), payload });
}

/** Discards the draft of a document as `who`. */
export function discardDraftAs(
  world: DocumentWorld,
  who: PersonName | null,
  installationId: number,
  documentId: number,
) {
  return world.ask(who, { method: 'DELETE', url: draftPath(installationId, documentId) });
}

/** The path of the version `versionId` of the document `documentId` of the installation `installationId`. */
export const versionPath = (installationId: number, documentId: number, versionId: number | string): string =>
  `${versionsPath(installationId, documentId)}/${versionId}`;

/** Reads a page of the history of a document as `who`; `query` is the query string with its `?`, or nothing. */
export function listVersionsAs(
  world: DocumentWorld,
  who: PersonName | null,
  target: { readonly installationId: number; readonly documentId: number },
  query = '',
) {
  return world.ask(who, { method: 'GET', url: `${versionsPath(target.installationId, target.documentId)}${query}` });
}

/** Reads one version of a document with its text as `who`. */
export function readVersionAs(
  world: DocumentWorld,
  who: PersonName | null,
  target: { readonly installationId: number; readonly documentId: number },
  versionId: number | string,
) {
  return world.ask(who, { method: 'GET', url: versionPath(target.installationId, target.documentId, versionId) });
}

/**
 * Saves `spec.text` as the draft of a document and publishes it through the routes, as `who`: a minor version over the one the
 * document points at now, with the rationale `Because`, unless the rest of `spec` changes the body. Answers the response of the publish.
 */
export async function publishTextAs(
  world: DocumentWorld,
  who: PersonName,
  target: { readonly installationId: number; readonly documentId: number },
  spec: { readonly text: string } & Readonly<Record<string, unknown>>,
) {
  const { text, ...over } = spec;
  const document = await world.db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', target.documentId)
    .executeTakeFirstOrThrow();
  const draft = await world.db
    .selectFrom('cla_drafts')
    .select('revision')
    .where('document_id', '=', target.documentId)
    .executeTakeFirst();
  const saved = await saveDraftAs(world, who, target, { contentMd: text, expectedRevision: draft?.revision ?? null });
  expect(saved.statusCode).toBe(200);
  return publishAs(world, who, target, {
    source: { type: 'draft', revision: (draft?.revision ?? 0) + 1 },
    bump: 'minor',
    rationale: 'Because',
    expectedActiveVersionId: document.active_version_id,
    ...over,
  });
}

/** Stores a version of a document past the routes, with the rationale as given; the hash is the one of the text. */
export async function storeVersion(
  world: DocumentWorld,
  documentId: number,
  spec: { readonly major: number; readonly minor: number; readonly text: string; readonly rationale: string },
): Promise<number> {
  const row = await world.db
    .insertInto('cla_versions')
    .values({
      document_id: documentId,
      major: spec.major,
      minor: spec.minor,
      content_md: spec.text,
      content_sha256: sha256(spec.text),
      published_by: world.t1.publisherId,
      rationale: spec.rationale,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
