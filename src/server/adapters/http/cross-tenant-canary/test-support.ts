// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ROW_TABLES } from '../../db/tenant-fixture/test-support.ts';
import { requireAuth } from '../auth-request.ts';
import type {
  CrossTenantCase,
  EndpointClass,
  IsolationCase,
  MatrixTarget,
  RequestSpec,
  RowRef,
} from '../cross-tenant-fixture/test-support.ts';
import type { MatrixWorld } from '../cross-tenant-runner/test-support.ts';
import { type TenantResolver, tenantAccess } from '../tenant-access.ts';
import { byDocumentParam, byInstallationParam, byRepositoryParam } from '../tenant-resolvers.ts';

// The routes the matrix of E11-S06 is proved on. The application has no tenant route yet, so the matrix is run over canaries
// that are routes of the same kinds the stories after this one add: a read and a write route about an installation, a
// repository and a document, and two routes open to any signed-in person that return tenant data by design. `leaky` routes
// break the rules on purpose, and the tests show the matrix fails on each of them.

const INSTALLATION_PATH = '/canary/installations/:installationId';
const REPOSITORY_PATH = '/canary/installations/:installationId/repositories/:repositoryId';
const DOCUMENT_PATH = '/canary/installations/:installationId/documents/:documentId';

/** The path of the canary route of this class. */
function pathOf(endpointClass: EndpointClass): string {
  switch (endpointClass) {
    case 'installation_read':
    case 'installation_write':
      return INSTALLATION_PATH;
    case 'repository_read':
    case 'repository_write':
      return REPOSITORY_PATH;
    case 'document_read':
    case 'document_write':
      return DOCUMENT_PATH;
  }
}

/** The path of a route of this class with the ids of `target` in it. */
function urlOf(endpointClass: EndpointClass, target: MatrixTarget): string {
  return pathOf(endpointClass)
    .replace(':installationId', String(target.installationId))
    .replace(':repositoryId', String(target.repositoryId))
    .replace(':documentId', String(target.documentId));
}

const caseOf = (endpointClass: EndpointClass): CrossTenantCase => ({
  endpointClass,
  request: (target): RequestSpec => ({
    method: endpointClass.endsWith('_read') ? 'GET' : 'POST',
    url: urlOf(endpointClass, target),
  }),
});

const routeOf = (endpointClass: EndpointClass): string =>
  `${endpointClass.endsWith('_read') ? 'GET' : 'POST'} ${pathOf(endpointClass)}`;

const CLASSES: readonly EndpointClass[] = [
  'installation_read',
  'installation_write',
  'repository_read',
  'repository_write',
  'document_read',
  'document_write',
];

/** One tenant route of each class, keyed `METHOD path`. */
export const CANARY_CASES: Readonly<Record<string, CrossTenantCase>> = Object.fromEntries(
  CLASSES.map((endpointClass) => [routeOf(endpointClass), caseOf(endpointClass)]),
);

const LEAKY_PATH = '/canary/leaky/installations/:installationId/repositories/:repositoryId';

/** A route that checks the role on the installation of its path and then reads the repository by its id alone. */
export const LEAKY_CASE: CrossTenantCase = {
  endpointClass: 'repository_read',
  request: (target) => ({
    method: 'GET',
    url: LEAKY_PATH.replace(':installationId', String(target.installationId)).replace(
      ':repositoryId',
      String(target.repositoryId),
    ),
  }),
};

export const LEAKY_ROUTE = `GET ${LEAKY_PATH}`;

export const LEAKY_CROSS_TENANT: Readonly<Record<string, CrossTenantCase>> = { [LEAKY_ROUTE]: LEAKY_CASE };

const queryParams = z.object({ installationId: z.coerce.number().optional() });

const rowsBody = z.object({ rows: z.array(z.object({ table: z.enum(ROW_TABLES), id: z.number() })) });

/** The tenant rows a canary answer names. */
const rowsOf = (body: unknown): readonly RowRef[] => rowsBody.parse(body).rows;

const injection = (injected: MatrixTarget | null): string =>
  injected === null ? '' : `?installationId=${injected.installationId}&repositoryId=${injected.repositoryId}`;

/** The two routes open to any signed-in person that return tenant data by design, as the stories of E13 add them. */
export const CANARY_ISOLATION: Readonly<Record<string, IsolationCase>> = {
  'GET /canary/me/signatures': {
    request: (_own, injected) => ({ method: 'GET', url: `/canary/me/signatures${injection(injected)}` }),
    rows: rowsOf,
    mayShow: (owner, viewer) => owner.userId === viewer.userId,
  },
  'GET /canary/sign/:githubRepoId': {
    request: (own, injected) => ({ method: 'GET', url: `/canary/sign/${own.githubRepoId}${injection(injected)}` }),
    rows: rowsOf,
    mayShow: (owner, viewer) => owner.installationId === viewer.own.installationId,
  },
};

/** A route that honours an injected installation id: it adds the signatures of that installation to the viewer's own. */
export const LEAKY_HONOURING: IsolationCase = {
  request: (_own, injected) => ({ method: 'GET', url: `/canary/leaky/me/signatures${injection(injected)}` }),
  rows: rowsOf,
  mayShow: (owner, viewer) => owner.userId === viewer.userId,
};

/** A route that filters nothing: every signature of every tenant. */
export const LEAKY_UNFILTERED: IsolationCase = {
  request: () => ({ method: 'GET', url: '/canary/leaky/signatures' }),
  rows: rowsOf,
  mayShow: (owner, viewer) => owner.userId === viewer.userId,
};

export const LEAKY_ISOLATION: Readonly<Record<string, IsolationCase>> = {
  'GET /canary/leaky/me/signatures': LEAKY_HONOURING,
  'GET /canary/leaky/signatures': LEAKY_UNFILTERED,
};

/**
 * Adds the canary routes to the app of `world`, before its first request, and returns the list each handler writes its
 * `METHOD path` to when it runs: a denied call never appears in it.
 */
export function addCanaryRoutes(world: MatrixWorld): string[] {
  const { app, db } = world;
  const reached: string[] = [];
  const handler = (request: FastifyRequest) => {
    reached.push(`${request.method} ${request.routeOptions.url}`);
    return { tenant: request.tenant };
  };
  const read = (resolve: TenantResolver) => ({ config: { access: tenantAccess({ mode: 'read', resolve }) } });
  const write = (resolve: TenantResolver) => ({ config: { access: tenantAccess({ mode: 'write', resolve }) } });
  const installation = byInstallationParam(db);
  const repository = byRepositoryParam(db);
  const document = byDocumentParam(db);
  app.get(INSTALLATION_PATH, read(installation), handler);
  app.post(INSTALLATION_PATH, write(installation), handler);
  app.get(REPOSITORY_PATH, read(repository), handler);
  app.post(REPOSITORY_PATH, write(repository), handler);
  app.get(DOCUMENT_PATH, read(document), handler);
  app.post(DOCUMENT_PATH, write(document), handler);
  addLeakyRoutes(world, handler);
  addIsolationRoutes(world);
  addLeakyIsolationRoutes(world);
  return reached;
}

/** The leaky tenant route: the guard checks the installation of the path, and the handler trusts the id of the repository. */
function addLeakyRoutes(world: MatrixWorld, handler: (request: FastifyRequest) => unknown): void {
  const { app, db } = world;
  app.get(
    LEAKY_PATH,
    { config: { access: tenantAccess({ mode: 'read', resolve: byInstallationParam(db) }) } },
    async (request) => {
      const params = z.object({ repositoryId: z.coerce.number() }).parse(request.params);
      const row = await db
        .selectFrom('repositories')
        .select('id')
        .where('id', '=', params.repositoryId)
        .executeTakeFirstOrThrow();
      handler(request);
      return { repository: row };
    },
  );
}

/** The signatures a canary answers with, as rows of the tenant tables. */
const signatureRows = (ids: readonly { readonly id: number }[]) => ({
  rows: ids.map((row) => ({ table: 'signatures', id: row.id })),
});

/** The isolation routes that keep to the viewer. */
function addIsolationRoutes(world: MatrixWorld): void {
  const { app, db } = world;
  const authenticated = { config: { access: 'authenticated' } } as const;
  app.get('/canary/me/signatures', authenticated, async (request) => {
    const mine = await db
      .selectFrom('signatures')
      .select('id')
      .where('user_id', '=', requireAuth(request).user.id)
      .orderBy('id')
      .execute();
    return signatureRows(mine);
  });
  app.get('/canary/sign/:githubRepoId', authenticated, async (request) => {
    const { githubRepoId } = z.object({ githubRepoId: z.coerce.number() }).parse(request.params);
    const repository = await db
      .selectFrom('repositories')
      .select(['id', 'installation_id'])
      .where('github_repo_id', '=', githubRepoId)
      .where('removed_at', 'is', null)
      .executeTakeFirstOrThrow();
    const documents = await db
      .selectFrom('cla_documents')
      .select('id')
      .where('installation_id', '=', repository.installation_id)
      .where((eb) => eb.or([eb('repository_id', '=', repository.id), eb('repository_id', 'is', null)]))
      .orderBy('repository_id', (order) => order.nullsLast())
      .limit(1)
      .executeTakeFirstOrThrow();
    return {
      rows: [
        { table: 'repositories', id: repository.id },
        { table: 'cla_documents', id: documents.id },
      ],
    };
  });
}

/** The isolation routes that do not: one honours an injected installation id, the other filters nothing. */
function addLeakyIsolationRoutes(world: MatrixWorld): void {
  const { app, db } = world;
  const authenticated = { config: { access: 'authenticated' } } as const;
  app.get('/canary/leaky/me/signatures', authenticated, async (request) => {
    const { installationId } = queryParams.parse(request.query);
    const rows = await db
      .selectFrom('signatures')
      .select('id')
      .where((eb) =>
        eb.or([eb('user_id', '=', requireAuth(request).user.id), eb('installation_id', '=', installationId ?? 0)]),
      )
      .orderBy('id')
      .execute();
    return signatureRows(rows);
  });
  app.get('/canary/leaky/signatures', authenticated, async () =>
    signatureRows(await db.selectFrom('signatures').select('id').orderBy('id').execute()),
  );
}
