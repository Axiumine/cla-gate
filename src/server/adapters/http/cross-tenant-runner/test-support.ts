// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect } from 'vitest';
import { z } from 'zod';
import { StubRoleLookup } from '../../../services/role-table-fixture/test-support.ts';
import type { Database } from '../../db/schema.ts';
import {
  type PersonName,
  type TenantWorld,
  tenantChecksums,
  twoTenants,
} from '../../db/tenant-fixture/test-support.ts';
import { type AuthWorld, authWorld } from '../auth-fixture/test-support.ts';
import type {
  CrossTenantCase,
  EndpointClass,
  IsolationCase,
  MatrixTarget,
  RequestSpec,
  RowOwner,
  RowRef,
} from '../cross-tenant-fixture/test-support.ts';
import { shapeOf } from '../tenant-guard-fixture/test-support.ts';

// The runner of the cross-tenant route matrix (E11-S06): the world it runs in (the real app on a migrated PGlite, two
// tenants, five people with sessions, and the roles GitHub reports from a table) and the assertions of one case of each
// table. The tables are in cross-tenant-fixture/test-support.ts; the routes the runner is proved on are the canaries.

type LoggedIn = Awaited<ReturnType<AuthWorld['login']>>;

/** The session of `who`, chosen by name without indexing a record by a variable. */
function sessionOf(sessions: Readonly<Record<PersonName, LoggedIn>>, who: PersonName): LoggedIn {
  switch (who) {
    case 'admin1':
      return sessions.admin1;
    case 'admin2':
      return sessions.admin2;
    case 'repoAdmin1':
      return sessions.repoAdmin1;
    case 'member1':
      return sessions.member1;
    case 'outsider':
      return sessions.outsider;
  }
}

/**
 * What the person sends: the session cookie, and for a state-changing request the origin and the token as well. Nobody sends
 * no cookie, and a state-changing request of nobody still carries the app's own origin, so that it is the missing session
 * that is refused (`401`) and not the origin (`403`).
 */
function headersOf(
  sessions: Readonly<Record<PersonName, LoggedIn>>,
  who: PersonName | null,
  read: boolean,
  origin: string,
) {
  if (who === null) {
    return read ? {} : { origin };
  }
  const session = sessionOf(sessions, who);
  return read ? { cookie: session.cookie } : session.headers;
}

/**
 * The world of the matrix: the real app (routes are added before the first request), two tenants with five people who are
 * logged in, and a `StubRoleLookup` that answers what GitHub says about them. `ask(who, spec)` sends a request as `who`
 * (nobody: no cookie); a state-changing one carries the origin and the token the app demands.
 */
export async function matrixWorld() {
  const roles = new StubRoleLookup();
  const world = await authWorld({}, { github: roles });
  const seeded = await twoTenants(world.db, roles);
  const sessions = {
    admin1: await world.login(seeded.people.admin1.githubId),
    admin2: await world.login(seeded.people.admin2.githubId),
    repoAdmin1: await world.login(seeded.people.repoAdmin1.githubId),
    member1: await world.login(seeded.people.member1.githubId),
    outsider: await world.login(seeded.people.outsider.githubId),
  };
  const ask = (who: PersonName | null, spec: RequestSpec) => {
    const read = spec.method === 'GET';
    return world.app.inject({
      method: spec.method,
      url: spec.url,
      ...(read ? {} : { payload: spec.payload ?? {} }),
      headers: headersOf(sessions, who, read, world.origin),
    });
  };
  return { ...world, ...seeded, ask };
}

export type MatrixWorld = Awaited<ReturnType<typeof matrixWorld>>;

/** Ids that exist nowhere: what an unknown resource looks like. */
const UNKNOWN_TARGET: MatrixTarget = {
  installationId: 987_654,
  repositoryId: 987_654,
  documentId: 987_654,
  githubRepoId: 987_654,
};

/** The resources of a tenant that no repo-scoped document covers: its installation, its plain repository and its installation-wide document. */
export const plainTarget = (tenant: TenantWorld): MatrixTarget => ({
  installationId: tenant.installationId,
  repositoryId: tenant.plain.repositoryId,
  documentId: tenant.documentId,
  githubRepoId: tenant.plain.githubRepoId,
});

/** The resources of a tenant that carry a repo-scoped document: the repository `repoAdmin1` administers, and its document. */
export const scopedTarget = (tenant: TenantWorld): MatrixTarget => ({
  installationId: tenant.installationId,
  repositoryId: tenant.scoped.repositoryId,
  documentId: tenant.scoped.documentId,
  githubRepoId: tenant.scoped.githubRepoId,
});

/** What the role matrix says for a class of endpoint, for tenant 1: the resource the allowed people reach and the one that is too high for a repo admin. */
function planOf(endpointClass: EndpointClass, tenant: TenantWorld) {
  const nested = !endpointClass.startsWith('installation_');
  return {
    ok: nested ? scopedTarget(tenant) : plainTarget(tenant),
    tooLow: plainTarget(tenant),
    /** Whether the admin of the repository that carries the resource passes: not for a route about the installation itself. */
    repoAdminPasses: nested,
    nested,
  };
}

type Shape = ReturnType<typeof shapeOf>;

/** Sends a request that must be denied and checks the status, that no tenant table changed, and returns the shape of the answer. */
type Deny = (who: PersonName | null, spec: RequestSpec, status: number, note?: string) => Promise<Shape>;

function denialProbe(world: MatrixWorld, route: string): Deny {
  return async (who, spec, status, note = '') => {
    const label = `${route}${note} as ${who ?? 'nobody'}`;
    const before = await tenantChecksums(world.db);
    const response = await world.ask(who, spec);
    expect(response.statusCode, label).toBe(status);
    expect(await tenantChecksums(world.db), `${label} changed a row`).toEqual(before);
    return shapeOf(response);
  };
}

const STRANGERS: readonly PersonName[] = ['admin2', 'member1', 'outsider'];
const ADMINS: readonly PersonName[] = ['admin1', 'admin2'];

/** The ids of the two tenants crossed: the installation of one with the repository and the document of the other. */
const crossed = (world: MatrixWorld): MatrixTarget[] => [
  { ...scopedTarget(world.t1), installationId: world.t2.installationId },
  { ...scopedTarget(world.t2), installationId: world.t1.installationId },
];

/** Every denial of the matrix, each an exact copy of the answer for a resource that does not exist. */
async function assertDenials(world: MatrixWorld, route: string, c: CrossTenantCase): Promise<void> {
  const plan = planOf(c.endpointClass, world.t1);
  const deny = denialProbe(world, route);
  const unknown = await deny('admin1', c.request(UNKNOWN_TARGET), 404);
  for (const who of STRANGERS) {
    expect(await deny(who, c.request(plan.ok), 404), `${route} as ${who} is not the answer for an unknown id`).toEqual(
      unknown,
    );
  }
  await deny(null, c.request(plan.ok), 401);
  await deny('repoAdmin1', c.request(plan.tooLow), 403);
  for (const target of plan.nested ? crossed(world) : []) {
    for (const who of ADMINS) {
      expect(
        await deny(who, c.request(target), 404, ' with crossed ids'),
        `${route} with crossed ids as ${who}`,
      ).toEqual(unknown);
    }
  }
}

/** The calls that are allowed: the admin of the organisation, and the admin of the repository where the role matrix lets them. */
async function assertSuccess(world: MatrixWorld, route: string, c: CrossTenantCase): Promise<void> {
  const plan = planOf(c.endpointClass, world.t1);
  const success = c.success ?? 200;
  expect((await world.ask('admin1', c.request(plan.ok))).statusCode, `${route} as its own admin`).toBe(success);
  if (plan.repoAdminPasses) {
    expect(
      (await world.ask('repoAdmin1', c.request(plan.ok))).statusCode,
      `${route} as the admin of the repository`,
    ).toBe(success);
  } else {
    await denialProbe(world, route)('repoAdmin1', c.request(plan.ok), 403);
  }
}

/**
 * Runs one case of `CROSS_TENANT_CASES` for tenant 1: tenant 2's admin, an org member, an outsider and crossed ids get the
 * `404` of a resource that does not exist, byte for byte; no session gets `401`; a repo admin gets `403` where the role
 * matrix says so; the tenant's own admin gets the success of the case; and no denied call changes a row of any tenant table.
 */
export async function assertCrossTenantCase(world: MatrixWorld, route: string, c: CrossTenantCase): Promise<void> {
  await assertDenials(world, route, c);
  await assertSuccess(world, route, c);
}

/** The query for the owner of a row of a tenant table: its installation, and the person it is about. `signer_pii` and `cla_versions` have no installation column of their own. */
function ownerQuery(ref: RowRef) {
  const id = ref.id;
  switch (ref.table) {
    case 'repositories':
      return sql`select installation_id, null::bigint as user_id from repositories where id = ${id}`;
    case 'cla_documents':
      return sql`select installation_id, null::bigint as user_id from cla_documents where id = ${id}`;
    case 'cla_versions':
      return sql`select d.installation_id, null::bigint as user_id from cla_versions v join cla_documents d on d.id = v.document_id where v.id = ${id}`;
    case 'signatures':
      return sql`select installation_id, user_id from signatures where id = ${id}`;
    case 'signer_pii':
      return sql`select s.installation_id, p.user_id from signer_pii p join signatures s on s.id = p.signature_id where p.signature_id = ${id}`;
    case 'commit_overrides':
      return sql`select installation_id, created_by as user_id from commit_overrides where id = ${id}`;
    case 'allowlist_entries':
      return sql`select installation_id, null::bigint as user_id from allowlist_entries where id = ${id}`;
    case 'pr_evaluations':
      return sql`select installation_id, null::bigint as user_id from pr_evaluations where id = ${id}`;
    case 'audit_log':
      return sql`select installation_id, null::bigint as user_id from audit_log where id = ${id}`;
  }
}

const ownerRow = z.object({ installation_id: z.number().nullable(), user_id: z.number().nullable() });

/** Who owns the row `ref` names, read from the database and not from the answer. @throws ZodError when there is no such row. */
export async function ownerOf(db: Kysely<Database>, ref: RowRef): Promise<RowOwner> {
  const { rows } = await ownerQuery(ref).execute(db);
  const row = ownerRow.parse(rows[0]);
  return { installationId: row.installation_id, userId: row.user_id };
}

/** One viewer of an isolation case: who they are, the tenant they ask about and the other tenant whose ids they inject. */
interface Viewer {
  readonly person: PersonName;
  readonly userId: number;
  readonly own: MatrixTarget;
  readonly other: MatrixTarget;
}

const viewersOf = (world: MatrixWorld): Viewer[] => [
  {
    person: 'member1',
    userId: world.people.member1.userId,
    own: scopedTarget(world.t1),
    other: scopedTarget(world.t2),
  },
  { person: 'admin2', userId: world.people.admin2.userId, own: scopedTarget(world.t2), other: scopedTarget(world.t1) },
];

/** The rows of the answer that the viewer may not be shown, as `table id`. */
async function rowsNotShown(world: MatrixWorld, c: IsolationCase, viewer: Viewer, answer: unknown): Promise<string[]> {
  const rows = c.rows(answer);
  expect(rows.length, 'the answer names no tenant row, so nothing was checked').toBeGreaterThan(0);
  const owned = await Promise.all(rows.map(async (ref) => ({ ref, owner: await ownerOf(world.db, ref) })));
  return owned
    .filter(({ owner }) => !c.mayShow(owner, { userId: viewer.userId, own: viewer.own }))
    .map(({ ref }) => `${ref.table} ${ref.id}`);
}

/**
 * Runs one case of `ISOLATION_CASES` for two viewers, one of each tenant: with no session the route answers `401`; the answer
 * names tenant rows, none of which the viewer may not be shown; and the answer to the same request with the ids of the other
 * tenant injected (in a path, a query or a body) is the answer without them.
 */
export async function assertIsolationCase(world: MatrixWorld, route: string, c: IsolationCase): Promise<void> {
  for (const viewer of viewersOf(world)) {
    expect((await world.ask(null, c.request(viewer.own, null))).statusCode, `${route} with no session`).toBe(401);
    const clean = await world.ask(viewer.person, c.request(viewer.own, null));
    expect(clean.statusCode, `${route} as ${viewer.person}`).toBe(200);
    expect(
      await rowsNotShown(world, c, viewer, clean.json()),
      `${route} shows ${viewer.person} rows of another tenant or person`,
    ).toEqual([]);
    const injected = await world.ask(viewer.person, c.request(viewer.own, viewer.other));
    expect(injected.statusCode, `${route} with injected ids`).toBe(200);
    expect(injected.body, `${route} does not ignore the ids ${viewer.person} injects`).toBe(clean.body);
  }
}
