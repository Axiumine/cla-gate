// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../db/schema.ts';
import type { RowTable } from '../../db/tenant-fixture/test-support.ts';
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
  /** The request of the viewer for their own resource; `injected` names resources of the other tenant, to try in a path, a query or a body. */
  readonly request: (own: MatrixTarget, injected: MatrixTarget | null) => RequestSpec;
  /** The tenant rows the body of the answer names. */
  readonly rows: (body: unknown) => readonly RowRef[];
  /** Whether the viewer may be shown the row: the case says what is theirs (their signature, the tenant of the repository they asked about). */
  readonly mayShow: (owner: RowOwner, viewer: IsolationViewer) => boolean;
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

/** The `tenant` routes of the application, keyed `METHOD path`. A story that adds one adds its case here (E13 to E16). */
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
};

/** The `authenticated` routes that return tenant data by design (E13: `GET /api/sign/:githubRepoId`, `GET /api/me/signatures`). */
export const ISOLATION_CASES: Readonly<Record<string, IsolationCase>> = {};

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
