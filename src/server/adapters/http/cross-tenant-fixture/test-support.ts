// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { AUDIT_LOG_PATH } from '../../../../shared/audit-log.ts';
import { DATA_EXPORT_PATH, dataExportSchema } from '../../../../shared/data-export.ts';
import { ERASURE_PREVIEW_PATH, ERASURES_PATH } from '../../../../shared/erasure.ts';
import { signContextResponseSchema, signContextRoute } from '../../../../shared/sign-context.ts';
import { SIGNATURES_CSV_PATH } from '../../../../shared/signature-export.ts';
import type { Database } from '../../db/schema.ts';
import type { RowTable, TenantWorld } from '../../db/tenant-fixture/test-support.ts';
import { sha256 } from '../../db/test-support.ts';
import { declaredAccess } from '../route-access-model.ts';

// The two tables of the cross-tenant route matrix (E11-S06). Every route that acts inside one tenant has an entry in
// `CROSS_TENANT_CASES`; every route that is open to any signed-in person and still returns tenant data by design has one in
// `ISOLATION_CASES`; an `authenticated` route that returns none says so in `NO_TENANT_DATA`. The completeness check
// (`matrixGaps`) names the route that has none, so a route cannot be added without its case. The matrix itself is in
// cross-tenant-runner/test-support.ts, and the cases it is proved on are the canary routes of cross-tenant-canary.
//
// A story that adds a route adds its case here in the same change:
//
//   'POST /api/installations/:installationId/documents': {
//     endpointClass: 'installation_write',
//     request: (target) => ({ method: 'POST', url: `/api/installations/${target.installationId}/documents`, payload: {...} }),
//   },

/** What a tenant route is about, which decides who may call it and how (the role matrix of the security notes). */
export type EndpointClass =
  | 'installation_read'
  | 'installation_write'
  | 'repository_read'
  | 'repository_write'
  | 'document_read'
  | 'document_write';

/** The ids of one resource of one tenant, which a request builder puts into its path, its query or its body. */
export interface MatrixTarget {
  /** `installations.id`. */
  readonly installationId: number;
  /** `repositories.id`. */
  readonly repositoryId: number;
  /** `cla_documents.id`. */
  readonly documentId: number;
  /** GitHub's id of the repository, for the routes keyed by it. */
  readonly githubRepoId: number;
}

/** A request as the matrix sends it: a state-changing one carries the origin and the token of the signed-in person on its own. */
export interface RequestSpec {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly payload?: object;
}

export interface CrossTenantCase {
  readonly endpointClass: EndpointClass;
  /** The request for the resource of `target`. The matrix sends it as every person of the two tenants, and with ids that exist nowhere. */
  readonly request: (target: MatrixTarget) => RequestSpec;
  /** The status of the answer to the person the call is for. Defaults to 200. */
  readonly success?: number;
  /**
   * Puts the resource of `target` in the state the request expects. The runner calls it before each call that must succeed,
   * for a request that succeeds once and not twice (a save that names the revision it read).
   */
  readonly prepare?: (db: Kysely<Database>, target: MatrixTarget) => Promise<void>;
  /**
   * The body of a call that must succeed, when it depends on the database at that moment (a publish names the version it
   * replaces, which each success changes). The runner reads it after `prepare` and sends it in place of the body of `request`.
   */
  readonly bodyFor?: (db: Kysely<Database>, target: MatrixTarget) => Promise<object>;
  /**
   * The URL of a call that must succeed, when it names a row that `prepare` creates (the version of a document, E12-S05). The runner
   * reads it after `prepare` and sends it in place of the URL of `request`, which holds an id that names nothing and serves the
   * calls that are denied before the row is looked up.
   */
  readonly urlFor?: (db: Kysely<Database>, target: MatrixTarget) => Promise<string>;
}

/** A row a response names, by table and `id` (`signature_id` for `signer_pii`). */
export interface RowRef {
  readonly table: RowTable;
  readonly id: number;
}

/** Who owns a row: its tenant, and the person it is about, when it has one. */
export interface RowOwner {
  readonly installationId: number | null;
  readonly userId: number | null;
}

/** Who asks, and the tenant the resource they ask about belongs to. */
interface IsolationViewer {
  readonly userId: number;
  readonly own: MatrixTarget;
}

export interface IsolationCase {
  /**
   * Puts the world of the matrix in the state the request needs, for both tenants, before the first call (a repository that
   * enforces a document that has a version). Without it a case has the rows `twoTenants` stores.
   */
  readonly arrange?: (db: Kysely<Database>, tenants: readonly TenantWorld[]) => Promise<void>;
  /** The request of the viewer for their own resource; `injected` names resources of the other tenant, to try in a path, a query or a body. */
  readonly request: (own: MatrixTarget, injected: MatrixTarget | null) => RequestSpec;
  /** The tenant rows the body of the answer names. */
  readonly rows: (body: unknown) => readonly RowRef[];
  /** Whether the viewer may be shown the row: the case says what is theirs (their signature, the tenant of the repository they asked about). */
  readonly mayShow: (owner: RowOwner, viewer: IsolationViewer) => boolean;
  /**
   * The part of an answer that must be the same with and without the injected ids, for a route whose answer also holds what
   * the first call changed (the export of the own data lists its own audit row, E16-S06). Absent: the whole body.
   */
  readonly stable?: (body: unknown) => unknown;
}

let documentNumber = 0;

/** A name no document of the world has, for a request that creates or renames: the matrix sends one request as several people. */
const freshDocumentName = (): string => {
  documentNumber += 1;
  return `Matrix document ${documentNumber}`;
};

const documentsUrl = (target: MatrixTarget): string => `/api/installations/${target.installationId}/documents`;

const draftUrl = (target: MatrixTarget): string => `${documentsUrl(target)}/${target.documentId}/draft`;

/** Brings the draft of the document of `target` to revision 1, saving one first when it has none: the save of the matrix names revision 1. */
async function draftAtFirstRevision(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const person = await db.selectFrom('users').select('id').orderBy('id').limit(1).executeTakeFirstOrThrow();
  await db
    .insertInto('cla_drafts')
    .values({
      document_id: target.documentId,
      installation_id: target.installationId,
      content_md: 'Matrix draft\n',
      updated_by: person.id,
    })
    .onConflict((conflict) => conflict.column('document_id').doUpdateSet({ revision: 1 }))
    .execute();
}

const versionsUrl = (target: MatrixTarget): string => `${documentsUrl(target)}/${target.documentId}/versions`;

/** The body of a publish that succeeds now: the saved draft as a major version over the version the document points at (none: the first). */
async function publishBody(db: Kysely<Database>, target: MatrixTarget): Promise<object> {
  const document = await db
    .selectFrom('cla_documents')
    .select('active_version_id')
    .where('id', '=', target.documentId)
    .executeTakeFirstOrThrow();
  return {
    source: { type: 'draft', revision: 1 },
    bump: 'major',
    rationale: 'Published by the matrix',
    expectedActiveVersionId: document.active_version_id,
    acknowledgeResigning: true,
  };
}

/** Gives the document of `target` its version 1.0 when it has none, and points the document at it, as a publish would leave it. */
async function versionOne(db: Kysely<Database>, target: MatrixTarget): Promise<void> {
  const existing = await db
    .selectFrom('cla_versions')
    .select('id')
    .where('document_id', '=', target.documentId)
    .executeTakeFirst();
  if (existing !== undefined) {
    return;
  }
  const person = await db.selectFrom('users').select('id').orderBy('id').limit(1).executeTakeFirstOrThrow();
  const version = await db
    .insertInto('cla_versions')
    .values({
      document_id: target.documentId,
      major: 1,
      minor: 0,
      content_md: 'Matrix version\n',
      content_sha256: sha256('Matrix version\n'),
      published_by: person.id,
      rationale: 'Made for the matrix',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', target.documentId)
    .execute();
}

/** The URL of the first version of the document of `target`, which `versionOne` made if there was none. */
async function firstVersionUrl(db: Kysely<Database>, target: MatrixTarget): Promise<string> {
  const version = await db
    .selectFrom('cla_versions')
    .select('id')
    .where('document_id', '=', target.documentId)
    .orderBy('id')
    .limit(1)
    .executeTakeFirstOrThrow();
  return `${versionsUrl(target)}/${version.id}`;
}

/**
 * The person the erasure cases (E16-S04) ask about: `member1`, the signer of tenant 1 (E11-S06 fixture). Erasing them ends
 * their session, so the erasure case is the last entry of {@link CROSS_TENANT_CASES}, and its route the last one registered:
 * a case that comes after it would meet a `member1` who is logged out. A case added later goes before it.
 */
const ERASED_IN_THE_MATRIX = 31_004;

/** The `tenant` routes of the application, keyed `METHOD path`. A story that adds a route (E12 to E16) adds its case here. */
export const CROSS_TENANT_CASES: Readonly<Record<string, CrossTenantCase>> = {
  // E12-S01. The case creates a document that covers the installation (org admin only); the repository-scoped body is shown in document-routes-create.test.ts.
  'POST /api/installations/:installationId/documents': {
    endpointClass: 'installation_write',
    success: 201,
    request: (target) => ({
      method: 'POST',
      url: documentsUrl(target),
      payload: { name: freshDocumentName(), kind: 'individual' },
    }),
  },
  'GET /api/installations/:installationId/documents': {
    endpointClass: 'installation_read',
    request: (target) => ({ method: 'GET', url: documentsUrl(target) }),
  },
  'GET /api/installations/:installationId/repositories/:repositoryId/documents': {
    endpointClass: 'repository_read',
    request: (target) => ({
      method: 'GET',
      url: `/api/installations/${target.installationId}/repositories/${target.repositoryId}/documents`,
    }),
  },
  'GET /api/installations/:installationId/documents/:documentId': {
    endpointClass: 'document_read',
    request: (target) => ({ method: 'GET', url: `${documentsUrl(target)}/${target.documentId}` }),
  },
  'PATCH /api/installations/:installationId/documents/:documentId': {
    endpointClass: 'document_write',
    request: (target) => ({
      method: 'PATCH',
      url: `${documentsUrl(target)}/${target.documentId}`,
      payload: { name: freshDocumentName() },
    }),
  },
  // E12-S03. The save names revision 1, which `prepare` restores before each call that must succeed.
  'GET /api/installations/:installationId/documents/:documentId/draft': {
    endpointClass: 'document_read',
    request: (target) => ({ method: 'GET', url: draftUrl(target) }),
  },
  'PUT /api/installations/:installationId/documents/:documentId/draft': {
    endpointClass: 'document_write',
    prepare: draftAtFirstRevision,
    request: (target) => ({
      method: 'PUT',
      url: draftUrl(target),
      payload: { contentMd: 'Saved by the matrix\n', expectedRevision: 1 },
    }),
  },
  'DELETE /api/installations/:installationId/documents/:documentId/draft': {
    endpointClass: 'document_write',
    success: 204,
    request: (target) => ({ method: 'DELETE', url: draftUrl(target) }),
  },
  // E12-S04. A publish consumes the draft and moves the pointer, so each call that must succeed gets a draft at revision 1 and the
  // version the document points at then. The tenants' repositories enforce nothing, so no job is sent.
  'POST /api/installations/:installationId/documents/:documentId/versions': {
    endpointClass: 'document_write',
    success: 201,
    prepare: draftAtFirstRevision,
    bodyFor: publishBody,
    request: (target) => ({
      method: 'POST',
      url: versionsUrl(target),
      payload: {
        source: { type: 'draft', revision: 1 },
        bump: 'major',
        rationale: 'Published by the matrix',
        expectedActiveVersionId: null,
        acknowledgeResigning: true,
      },
    }),
  },
  // E12-S05. The history is read only. The version a call reads is made by `prepare` (a document of the matrix may have none), so the URL
  // of a call that must succeed names it; the one in `request` names no version, which is what the denied calls need.
  'GET /api/installations/:installationId/documents/:documentId/versions': {
    endpointClass: 'document_read',
    request: (target) => ({ method: 'GET', url: versionsUrl(target) }),
  },
  'GET /api/installations/:installationId/documents/:documentId/versions/:versionId': {
    endpointClass: 'document_read',
    prepare: versionOne,
    urlFor: firstVersionUrl,
    request: (target) => ({ method: 'GET', url: `${versionsUrl(target)}/${target.documentId}` }),
  },
  [`GET ${AUDIT_LOG_PATH}`]: {
    endpointClass: 'installation_read',
    request: (target) => ({
      method: 'GET',
      url: AUDIT_LOG_PATH.replace(':installationId', String(target.installationId)),
    }),
  },
  [`GET ${SIGNATURES_CSV_PATH}`]: {
    endpointClass: 'document_read',
    request: (target) => ({
      method: 'GET',
      url: SIGNATURES_CSV_PATH.replace(':installationId', String(target.installationId)).replace(
        ':documentId',
        String(target.documentId),
      ),
    }),
  },
  [`GET ${ERASURE_PREVIEW_PATH}`]: {
    endpointClass: 'installation_read',
    request: (target) => ({
      method: 'GET',
      url: `${ERASURE_PREVIEW_PATH.replace(':installationId', String(target.installationId))}?githubUserId=${ERASED_IN_THE_MATRIX}`,
    }),
  },
  [`POST ${ERASURES_PATH}`]: {
    endpointClass: 'installation_write',
    request: (target) => ({
      method: 'POST',
      url: ERASURES_PATH.replace(':installationId', String(target.installationId)),
      payload: { githubUserId: ERASED_IN_THE_MATRIX, expectedRows: 1 },
    }),
  },
};

/**
 * The sign context (E13-S02) is open to any signed-in person and answers with the document, version and signatures of the tenant
 * that holds the repository the path names. The path is the only input, so there is no id of another tenant to inject: the
 * request is the same with or without it, and the answer must be the same. The matrix makes the scoped repository of each
 * tenant enforce the tenant's document (version 1.0, signed by the tenant's signer), so tenant 1's signer is shown tenant 1's
 * document, version and own signature and nothing of tenant 2.
 */
const SIGN_CONTEXT_CASE: IsolationCase = {
  arrange: async (db, tenants) => {
    await Promise.all(
      tenants.map((tenant) =>
        db
          .updateTable('repositories')
          .set({ cla_document_id: tenant.documentId })
          .where('id', '=', tenant.scoped.repositoryId)
          .execute(),
      ),
    );
  },
  request: (own) => ({
    method: 'GET',
    url: signContextRoute.path.replace(':githubRepoId', String(own.githubRepoId)),
  }),
  rows: (body) => {
    const context = signContextResponseSchema.parse(body);
    return [
      { table: 'cla_documents' as const, id: context.document.id },
      { table: 'cla_versions' as const, id: context.version.id },
      ...(context.signature === null ? [] : [{ table: 'signatures' as const, id: context.signature.id }]),
    ];
  },
  mayShow: (owner, viewer) =>
    owner.installationId === viewer.own.installationId && (owner.userId === null || owner.userId === viewer.userId),
};

/**
 * The `authenticated` routes that return tenant data by design (E13: `GET /api/sign/:githubRepoId`, E13-S06 adds
 * `GET /api/me/signatures`; E16: `GET /api/me/export`). The export of a person's own data names the signatures of the person in
 * every tenant, and the personal data kept for each; the route takes no parameter at all (a query parameter is a `400`, shown in
 * data-export-routes.test.ts), so there is nothing of another tenant to inject and the request is the same with or without it.
 */
export const ISOLATION_CASES: Readonly<Record<string, IsolationCase>> = {
  [`GET ${DATA_EXPORT_PATH}`]: {
    request: () => ({ method: 'GET', url: DATA_EXPORT_PATH }),
    rows: (body) =>
      dataExportSchema
        .parse(body)
        .signatures.flatMap((signature) => [
          { table: 'signatures' as const, id: signature.id },
          ...(signature.personalData === null ? [] : [{ table: 'signer_pii' as const, id: signature.id }]),
        ]),
    mayShow: (owner, viewer) => owner.userId === viewer.userId,
    // Every export appends an audit row that the next one lists, so the second answer holds one entry more than the first.
    stable: (body) => ({ ...dataExportSchema.parse(body), auditEntries: [] }),
  },
  [`GET ${signContextRoute.path}`]: SIGN_CONTEXT_CASE,
};

/** The `authenticated` routes that return no tenant data, each with the reason, so a new one is a decision somebody reads. */
export const NO_TENANT_DATA: Readonly<Record<string, string>> = {
  'GET /api/auth/session': 'it answers with the signed-in person and nothing of any tenant (E10-S02)',
  'POST /api/auth/logout': 'it ends the session of the caller and returns no data (E10-S06)',
};

/** The tables the completeness check holds a route table to. */
export interface CaseTables {
  readonly cross: Readonly<Record<string, unknown>>;
  readonly isolation: Readonly<Record<string, unknown>>;
  readonly noTenantData: Readonly<Record<string, string>>;
}

/** One route as `app.routeAccess` has it. */
interface RouteEntry {
  readonly method: string;
  readonly url: string;
  readonly access: unknown;
}

const nameOf = (entry: RouteEntry): string => `${entry.method} ${entry.url}`;

/** A declaration that is an object is the one of a tenant route: the other kinds are words. */
const isTenantRoute = (entry: RouteEntry): boolean => typeof declaredAccess(entry.access) === 'object';

/** The names in `keys` that are not in `names`. */
const outside = (keys: readonly string[], names: readonly string[]): string[] =>
  keys.filter((key) => !names.includes(key));

/**
 * What is missing or stale, one sentence per route: a `tenant` route with no entry in `cross`, an `authenticated` route
 * in neither `isolation` nor `noTenantData`, an entry that names no route of its kind, and a route that is in both of
 * the last two. An empty list means the matrix covers the route table.
 */
export function matrixGaps(table: readonly RouteEntry[], tables: CaseTables): string[] {
  const tenant = table.filter(isTenantRoute).map(nameOf);
  const authenticated = table.filter((entry) => entry.access === 'authenticated').map(nameOf);
  const cross = Object.keys(tables.cross);
  const isolation = Object.keys(tables.isolation);
  const unclassified = Object.keys(tables.noTenantData);
  return [
    ...outside(tenant, cross).map((name) => `tenant route ${name} has no entry in CROSS_TENANT_CASES`),
    ...outside(cross, tenant).map((name) => `CROSS_TENANT_CASES has an entry for ${name}, which is not a tenant route`),
    ...authenticated
      .filter((name) => !isolation.includes(name) && !unclassified.includes(name))
      .map((name) => `authenticated route ${name} is in neither ISOLATION_CASES nor NO_TENANT_DATA`),
    ...outside(isolation, authenticated).map(
      (name) => `ISOLATION_CASES has an entry for ${name}, which is not an authenticated route`,
    ),
    ...outside(unclassified, authenticated).map(
      (name) => `NO_TENANT_DATA has an entry for ${name}, which is not an authenticated route`,
    ),
    ...isolation
      .filter((name) => unclassified.includes(name))
      .map((name) => `${name} is in ISOLATION_CASES and in NO_TENANT_DATA`),
  ];
}
