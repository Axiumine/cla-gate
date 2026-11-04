// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql, type Updateable } from 'kysely';
import { expect } from 'vitest';
import { z } from 'zod';
import { recordAdminSeen } from '../../../services/admin-ledger-queries.ts';
import { StubRoleLookup } from '../../../services/role-table-fixture/test-support.ts';
import { FakeGitHub } from '../../../services/test-support.ts';
import type { TestAppOptions } from '../../../test-support.ts';
import type { Database } from '../../db/schema.ts';
import {
  type PersonName,
  type RowTable,
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
 * (nobody: no cookie); a state-changing one carries the origin and the token the app demands. `env` adds to the login
 * settings of the app (the operator ids of E11-S08, for instance); `app` adds the options of the app a test sets (the queue the
 * publish of a major version sends its jobs to, E12-S04, and the GitHub an allowlist entry looks accounts up on, E14-S06).
 */
export async function matrixWorld(
  env: Readonly<Record<string, string>> = {},
  app: Pick<TestAppOptions, 'enqueuer' | 'allowlistGitHub'> = {},
) {
  const roles = new StubRoleLookup();
  const fakeGitHub = new FakeGitHub();
  const world = await authWorld(env, { github: roles, allowlistGitHub: fakeGitHub, publicGitHub: fakeGitHub, ...app });
  const seeded = await twoTenants(world.db, roles);
  // The GitHub of the allowlist (E14-S06) knows both organisations, so an `org_members` entry can be added to either tenant.
  for (const { githubInstallationId, accountId, accountLogin } of [seeded.t1, seeded.t2]) {
    const account = { id: accountId, login: accountLogin, type: 'Organization' } as const;
    fakeGitHub.addInstallation({ id: githubInstallationId, account, suspendedAt: null, permissions: {} });
  }
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
  return { ...world, ...seeded, fakeGitHub, ask };
}

export type MatrixWorld = Awaited<ReturnType<typeof matrixWorld>>;

/** Ids that exist nowhere: what an unknown resource looks like. */
const UNKNOWN_TARGET: MatrixTarget = {
  installationId: 987_654,
  repositoryId: 987_654,
  documentId: 987_654,
  githubRepoId: 987_654,
  entryId: 987_654,
};

/** The resources of a tenant that no repo-scoped document covers: its installation, its plain repository and its installation-wide document. */
export const plainTarget = (tenant: TenantWorld): MatrixTarget => ({
  installationId: tenant.installationId,
  repositoryId: tenant.plain.repositoryId,
  documentId: tenant.documentId,
  githubRepoId: tenant.plain.githubRepoId,
  entryId: tenant.entryId,
});

/** The resources of a tenant that carry a repo-scoped document: the repository `repoAdmin1` administers, and its document. */
export const scopedTarget = (tenant: TenantWorld): MatrixTarget => ({
  installationId: tenant.installationId,
  repositoryId: tenant.scoped.repositoryId,
  documentId: tenant.scoped.documentId,
  githubRepoId: tenant.scoped.githubRepoId,
  entryId: tenant.entryId,
});

/** What the role matrix says for a class of endpoint, for tenant 1: the resource the allowed people reach and the one that is too high for a repo admin. */
function planOf(endpointClass: EndpointClass, tenant: TenantWorld) {
  const nested = !endpointClass.startsWith('installation_');
  const openToAnyRole = endpointClass === 'installation_role_read';
  return {
    ok: nested ? scopedTarget(tenant) : plainTarget(tenant),
    /** The resource that is too high for a repo admin, or null for a route that every role in the installation may call. */
    tooLow: openToAnyRole ? null : plainTarget(tenant),
    /** Whether the admin of the repository that carries the resource passes: not for a route about the installation itself, unless any role may call it. */
    repoAdminPasses: nested || openToAnyRole,
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

/**
 * The denials with crossed ids of a route about a repository: the admin of either tenant, asking with the installation of one
 * tenant and the repository of the other, gets the answer for an unknown id. A route whose path has no installation id
 * (`crossable: false`) has nothing to cross, and a route about the installation itself has no repository to cross it with.
 */
async function assertCrossedDenied(
  world: MatrixWorld,
  route: string,
  c: CrossTenantCase,
  denial: { readonly deny: Deny; readonly unknown: Shape },
): Promise<void> {
  const targets = planOf(c.endpointClass, world.t1).nested && c.crossable !== false ? crossed(world) : [];
  for (const target of targets) {
    for (const who of ADMINS) {
      expect(
        await denial.deny(who, c.request(target), 404, ' with crossed ids'),
        `${route} with crossed ids as ${who}`,
      ).toEqual(denial.unknown);
    }
  }
}

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
  if (plan.tooLow !== null) {
    await deny('repoAdmin1', c.request(plan.tooLow), 403);
  }
  await assertCrossedDenied(world, route, c, { deny, unknown });
}

/** Sends the request of the case as `who` to a call that must succeed, after the case has put the resource in the state it expects. */
async function askAllowed(world: MatrixWorld, c: CrossTenantCase, who: PersonName, target: MatrixTarget) {
  await c.prepare?.(world.db, target);
  const spec = c.request(target);
  const url = await c.urlFor?.(world.db, target);
  const payload = await c.bodyFor?.(world.db, target);
  return world.ask(who, {
    ...spec,
    ...(url === undefined ? {} : { url }),
    ...(payload === undefined ? {} : { payload }),
  });
}

/** The calls that are allowed: the admin of the organisation, and the admin of the repository where the role matrix lets them. */
async function assertSuccess(world: MatrixWorld, route: string, c: CrossTenantCase): Promise<void> {
  const plan = planOf(c.endpointClass, world.t1);
  const success = c.success ?? 200;
  expect((await askAllowed(world, c, 'admin1', plan.ok)).statusCode, `${route} as its own admin`).toBe(success);
  if (plan.repoAdminPasses) {
    expect(
      (await askAllowed(world, c, 'repoAdmin1', plan.ok)).statusCode,
      `${route} as the admin of the repository`,
    ).toBe(success);
  } else {
    // The success above may have used the resource up (the removal of an entry, E14-S07): the denial is for the resource as it was.
    await c.prepare?.(world.db, plan.ok);
    await denialProbe(world, route)('repoAdmin1', c.request(plan.ok), 403);
  }
}

/** A little more than the minute of the per-person budget of uncached role lookups. */
const LOOKUP_WINDOW_MS = 61_000;

/**
 * Runs one case of `CROSS_TENANT_CASES` for tenant 1: tenant 2's admin, an org member, an outsider and crossed ids get the
 * `404` of a resource that does not exist, byte for byte; no session gets `401`; a repo admin gets `403` where the role
 * matrix says so; the tenant's own admin gets the success of the case; and no denied call changes a row of any tenant table.
 */
export async function assertCrossTenantCase(world: MatrixWorld, route: string, c: CrossTenantCase): Promise<void> {
  await assertDenials(world, route, c);
  await assertSuccess(world, route, c);
  // A write asks GitHub again for every request (E11-S01) and a person has 30 uncached lookups a minute (E11-S04): the table has
  // more writes than that for the admin of the repository, so the next case starts a minute later (E14-S06).
  world.clock.advance(LOOKUP_WINDOW_MS);
}

/** The states a tenant can be in besides active, which the matrix runs once more for (E11-S07). */
export type InactiveState = 'rejected' | 'suspended' | 'deleted';

const AWAY_AT = new Date('2026-10-01T00:00:00Z');

/** The columns of an installation row that put it in `state`. */
function columnsOf(state: InactiveState): Updateable<Database['installations']> {
  switch (state) {
    case 'rejected':
      return { admission_status: 'rejected', admission_reason: 'policy_changed' };
    case 'suspended':
      return { suspended_at: AWAY_AT };
    case 'deleted':
      return { deleted_at: AWAY_AT };
  }
}

/** Tenant 1 is put in `state`, or back to active when none is given. */
async function setStateOfTenant1(world: MatrixWorld, state: InactiveState | null): Promise<void> {
  const active = {
    admission_status: 'admitted',
    admission_reason: null,
    suspended_at: null,
    deleted_at: null,
  } as const;
  await world.db
    .updateTable('installations')
    .set(state === null ? active : { ...active, ...columnsOf(state) })
    .where('id', '=', world.t1.installationId)
    .execute();
}

/** The entry of `admin1` in the ledger is brought to now, as a live lookup that said yes a moment ago would: the fixture's entry is older than 14 days. */
async function seeAdmin1Now(world: MatrixWorld): Promise<void> {
  const now = world.clock.now();
  await recordAdminSeen(world.db, { installationId: world.t1.installationId }, world.people.admin1.githubId, {
    seenAt: now,
    refreshAtOrBefore: now,
  });
}

/** The code of the `409` a write gets while the tenant is in `state`. */
function conflictCode(state: 'suspended' | 'deleted'): string {
  return state === 'suspended' ? 'installation_suspended' : 'installation_deleted';
}

/** A tenant that is away is told nothing: everybody who is not the admin the ledger remembers gets the `404` of an unknown id. */
async function assertAwayDenials(world: MatrixWorld, route: string, c: CrossTenantCase): Promise<void> {
  const plan = planOf(c.endpointClass, world.t1);
  const deny = denialProbe(world, route);
  const unknown = await deny('admin1', c.request(UNKNOWN_TARGET), 404);
  for (const who of [...STRANGERS, 'repoAdmin1'] as const) {
    expect(await deny(who, c.request(plan.ok), 404), `${route} as ${who} is not the answer for an unknown id`).toEqual(
      unknown,
    );
  }
  await deny(null, c.request(plan.ok), 401);
  await assertCrossedDenied(world, route, c, { deny, unknown });
}

/**
 * Runs one case of `CROSS_TENANT_CASES` once more with tenant 1 in `state` (E11-S07), then puts it back. A suspended or
 * deleted tenant serves a `read` route its normal success to the admin the ledger remembers and refuses a `write` route with
 * the `409` of its state, whatever repository the route is about; every other person gets the `404` of an unknown id, byte for
 * byte, a repository admin included (their permission cannot be checked). A rejected tenant is invisible to everybody, the
 * remembered admin too. No denied call changes a row of any tenant table.
 */
export async function assertInactiveCase(
  world: MatrixWorld,
  route: string,
  c: CrossTenantCase,
  state: InactiveState,
): Promise<void> {
  await seeAdmin1Now(world);
  await setStateOfTenant1(world, state);
  await assertAwayDenials(world, route, c);
  const plan = planOf(c.endpointClass, world.t1);
  if (state === 'rejected') {
    await denialProbe(world, route)('admin1', c.request(plan.ok), 404, ' of a rejected tenant');
  } else if (c.endpointClass.endsWith('_write')) {
    const refused = await denialProbe(world, route)('admin1', c.request(plan.ok), 409, ` of a ${state} tenant`);
    expect(refused.body, `${route} of a ${state} tenant`).toContain(`"code":"${conflictCode(state)}"`);
  } else {
    const served = await askAllowed(world, c, 'admin1', plan.ok);
    expect(served.statusCode, `${route} of a ${state} tenant as the admin the ledger remembers`).toBe(c.success ?? 200);
  }
  await setStateOfTenant1(world, null);
}

/**
 * The world of the operator checks (E11-S08): the matrix world with `outsider` as the one operator of the instance. They
 * are the person GitHub knows nothing about in either tenant, so the operator role is the only thing they have.
 */
export async function operatorWorld() {
  const world = await matrixWorld({ OPERATOR_GITHUB_IDS: '31005' });
  expect(world.people.outsider.githubId).toBe(31_005);
  return world;
}

/** Every resource of the two tenants an operator may try, and the ids of the two tenants crossed. */
const operatorTargets = (world: MatrixWorld): MatrixTarget[] => [
  plainTarget(world.t1),
  scopedTarget(world.t1),
  plainTarget(world.t2),
  scopedTarget(world.t2),
  ...crossed(world),
];

/**
 * Runs one case of the route table for the operator of `operatorWorld` (E11-S08), with tenant 1 in `state` (active when none
 * is given), then puts it back. An operator who is neither org admin nor admin the ledger remembers is a stranger to every
 * tenant: each resource of both tenants, and the crossed ids, get the `404` of an unknown id byte for byte, and no row of any
 * tenant table changes. While tenant 1 is active the admin of its organisation is shown to get the success of the case, so
 * the request is a valid one and the `404` is the operator's.
 */
export async function assertOperatorCase(
  world: MatrixWorld,
  route: string,
  c: CrossTenantCase,
  state: InactiveState | null = null,
): Promise<void> {
  await setStateOfTenant1(world, state);
  const deny = denialProbe(world, route);
  const unknown = await deny('outsider', c.request(UNKNOWN_TARGET), 404, ' (the operator)');
  for (const target of operatorTargets(world)) {
    expect(
      await deny('outsider', c.request(target), 404, ' (the operator)'),
      `${route} gives the operator more than the answer for an unknown id`,
    ).toEqual(unknown);
  }
  if (state === null) {
    const control = await askAllowed(world, c, 'admin1', planOf(c.endpointClass, world.t1).ok);
    expect(control.statusCode, `${route} as the admin of the tenant`).toBe(c.success ?? 200);
  }
  await setStateOfTenant1(world, null);
  // A write asks GitHub again for every request (E11-S01) and a person has 30 uncached lookups a minute (E11-S04): a case
  // sends more than a dozen as the operator, so the next one starts a minute later, with the budget of a minute ago spent.
  world.clock.advance(LOOKUP_WINDOW_MS);
}

/** The query for the owner of a row of a tenant table: its installation, and the person it is about. `signer_pii` and `cla_versions` have no installation column of their own. */
function ownerQuery(ref: { readonly table: RowTable; readonly id: number }) {
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
  // An installation is its own tenant: its row names no other.
  const query =
    ref.table === 'installations'
      ? sql`select id as installation_id, null::bigint as user_id from installations where id = ${ref.id}`
      : ownerQuery({ table: ref.table, id: ref.id });
  const { rows } = await query.execute(db);
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

/** The viewers of a case: the person of tenant 1 and the person of tenant 2 it names (`member1` and `admin2` by default). */
const viewersOf = (world: MatrixWorld, people: IsolationCase['people'] = ['member1', 'admin2']): Viewer[] => [
  {
    person: people[0],
    userId: world.people[people[0]].userId,
    own: scopedTarget(world.t1),
    other: scopedTarget(world.t2),
  },
  {
    person: people[1],
    userId: world.people[people[1]].userId,
    own: scopedTarget(world.t2),
    other: scopedTarget(world.t1),
  },
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
  await c.arrange?.(world.db, [world.t1, world.t2]);
  for (const viewer of viewersOf(world, c.people)) {
    expect((await world.ask(null, c.request(viewer.own, null))).statusCode, `${route} with no session`).toBe(401);
    const clean = await world.ask(viewer.person, c.request(viewer.own, null));
    expect(clean.statusCode, `${route} as ${viewer.person}`).toBe(200);
    expect(
      await rowsNotShown(world, c, viewer, clean.json()),
      `${route} shows ${viewer.person} rows of another tenant or person`,
    ).toEqual([]);
    const injected = await world.ask(viewer.person, c.request(viewer.own, viewer.other));
    expect(injected.statusCode, `${route} with injected ids`).toBe(200);
    const stable = (body: string): unknown => (c.stable === undefined ? body : c.stable(JSON.parse(body)));
    expect(stable(injected.body), `${route} does not ignore the ids ${viewer.person} injects`).toEqual(
      stable(clean.body),
    );
  }
}
