// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import { scopeDocuments } from '../../../services/discovery-fixture/test-support.ts';
import { id, installation } from '../../../services/github-contract/test-support.ts';
import type { InstallationUpsert } from '../../../services/installation-state.ts';
import { createInstallationStore, type InstallationStore } from '../../../services/installation-store.ts';
import { installationOf, listed, repoId } from '../../../services/store-fixture/test-support.ts';
import { FakeGitHub } from '../../../services/test-support.ts';
import type { Database } from '../../db/schema.ts';
import { type AuthWorld, authWorld } from '../auth-fixture/test-support.ts';
import { type TenantResolver, tenantAccess } from '../tenant-access.ts';
import { byInstallationParam, byRepositoryParam } from '../tenant-resolvers.ts';

// The world of the tenant guard tests (E11-S05): the real app on a migrated PGlite, an in-memory GitHub, a handful of people
// with sessions, and four probe routes (a read and a write route about an installation, a read and a write route about a
// repository) whose handlers record that they ran and answer with `request.tenant`.
//
// Tenants (organisation `org-<n>`, GitHub installation id `n * 100`, repositories `org-<n>/repo-1` to `repo-3`):
//   1  the tenant under test: `repo-1` and `repo-2` carry a repo-scoped document, `repo-3` is removed
//   2  a second admitted tenant
//   3  rejected by the admission policy
//   4  a user account, suspended; 5 a user account, deleted; 6 an organisation, suspended
// People (login `login-<id>`, GitHub knows them by the numeric id):
//   admin1: org admin of 1;  repoAdmin1: admin of 1/repo-1 only;  repoAdminOther: admin of 1/repo-2 only;
//   member1: plain member of 1;  outsider: knows nothing;  admin2: org admin of 2;  owner: owns the accounts of 4 and 5.

export const PEOPLE = {
  admin1: 1001,
  repoAdmin1: 1002,
  repoAdminOther: 1003,
  member1: 1004,
  outsider: 1005,
  admin2: 1006,
  owner: 1007,
} as const;

export type Person = keyof typeof PEOPLE;

const DECIDED_AT = new Date('2026-05-01T10:00:00Z');
const SUSPENDED_AT = new Date('2026-06-01T12:00:00Z');

/** The GitHub installation id of tenant `n`. */
export const githubInstallationOf = (n: number): GithubId => parseGithubId(n * 100);

/** The stored row of the user account that `PEOPLE.owner` owns, with the state the test gives it. */
const ownedAccount = (n: number, overrides: Partial<InstallationUpsert>) =>
  installationOf(n, {
    accountType: 'User',
    accountId: parseGithubId(PEOPLE.owner),
    accountLogin: `login-${PEOPLE.owner}`,
    ...overrides,
  });

/** Stores tenant `n` as `snapshot` says, with three repositories `org-<n>/repo-1` to `repo-3`; resolves to its `installations.id`. */
async function storeTenant(store: InstallationStore, n: number, snapshot: InstallationUpsert) {
  const row = await store.upsertInstallation(snapshot);
  await store.upsertRepositories(row.id, [listed(n, 1), listed(n, 2), listed(n, 3)]);
  return row.id;
}

/** `repositories.id` of the repository with this GitHub id. */
async function repositoryRowId(db: Kysely<Database>, githubRepoId: GithubId): Promise<number> {
  const row = await db
    .selectFrom('repositories')
    .select('id')
    .where('github_repo_id', '=', githubRepoId)
    .executeTakeFirstOrThrow();
  return row.id;
}

/** What GitHub says: the organisations, who is an admin or a member of 1 and 2, and who administers which repository of 1. */
function scriptGitHub(fake: FakeGitHub): void {
  for (const n of [1, 2, 3, 6]) {
    fake.addInstallation(installation(githubInstallationOf(n), `org-${n}`));
  }
  const membership = (n: number, person: number, role: 'admin' | 'member') => {
    fake.addMembership(id(n * 100), `org-${n}`, `login-${person}`, { state: 'active', role, userId: id(person) });
  };
  membership(1, PEOPLE.admin1, 'admin');
  membership(1, PEOPLE.member1, 'member');
  membership(2, PEOPLE.admin2, 'admin');
  membership(6, PEOPLE.admin1, 'admin');
  const admin = (repo: string, person: number) => {
    fake.addRepositoryPermission(id(100), `org-1/${repo}`, `login-${person}`, {
      permission: 'admin',
      userId: id(person),
    });
  };
  admin('repo-1', PEOPLE.repoAdmin1);
  admin('repo-2', PEOPLE.repoAdminOther);
}

/** The rows: the six tenants with three repositories each, the documents of tenant 1, and tenant 1's third repository removed. */
async function seedTenants(db: Kysely<Database>) {
  const store = createInstallationStore(db);
  const rejection = { status: 'rejected', reason: 'account_not_allowed', decidedAt: DECIDED_AT } as const;
  const t1 = await storeTenant(store, 1, installationOf(1));
  const t2 = await storeTenant(store, 2, installationOf(2));
  const rejected = await storeTenant(store, 3, installationOf(3, { admission: rejection }));
  const suspendedUser = await storeTenant(store, 4, ownedAccount(4, { suspendedAt: SUSPENDED_AT }));
  const deletedUser = await storeTenant(store, 5, ownedAccount(5, { deletedAt: SUSPENDED_AT }));
  const suspendedOrg = await storeTenant(store, 6, installationOf(6, { suspendedAt: SUSPENDED_AT }));
  await scopeDocuments(db, t1, ['org-1/repo-1', 'org-1/repo-2']);
  await store.markRepositoriesRemoved(t1, [repoId(1, 3)], SUSPENDED_AT);
  const repository = (n: number, index: number) => repositoryRowId(db, repoId(n, index));
  return {
    tenants: { t1, t2, rejected, suspendedUser, deletedUser, suspendedOrg },
    repositories: {
      t1r1: await repository(1, 1),
      t1r2: await repository(1, 2),
      t1removed: await repository(1, 3),
      t2r1: await repository(2, 1),
      rejectedR1: await repository(3, 1),
      suspendedOrgR1: await repository(6, 1),
    },
  };
}

/** The probe routes, each recording its name in `reached` and answering `request.tenant`. */
function addProbeRoutes(world: AuthWorld, reached: string[]): void {
  const { app, db } = world;
  const handler = (name: string) => (request: FastifyRequest) => {
    reached.push(name);
    return { tenant: request.tenant };
  };
  const access = (mode: 'read' | 'write', resolve: TenantResolver) => ({
    config: { access: tenantAccess({ mode, resolve }) },
  });
  app.get('/t/installations/:installationId', access('read', byInstallationParam(db)), handler('installation-get'));
  app.post('/t/installations/:installationId', access('write', byInstallationParam(db)), handler('installation-post'));
  app.get('/t/repositories/:repositoryId', access('read', byRepositoryParam(db)), handler('repository-get'));
  app.post('/t/repositories/:repositoryId', access('write', byRepositoryParam(db)), handler('repository-post'));
}

/** Every tenant table as its rows read now: what a denied call must leave exactly as it was. */
export async function tenantTables(db: Kysely<Database>): Promise<string> {
  const tables = await Promise.all([
    db.selectFrom('installations').selectAll().orderBy('id').execute(),
    db.selectFrom('repositories').selectAll().orderBy('id').execute(),
    db.selectFrom('cla_documents').selectAll().orderBy('id').execute(),
    db.selectFrom('cla_versions').selectAll().orderBy('id').execute(),
    db.selectFrom('signatures').selectAll().orderBy('id').execute(),
    db.selectFrom('signer_pii').selectAll().orderBy('signature_id').execute(),
    db.selectFrom('commit_overrides').selectAll().orderBy('id').execute(),
    db.selectFrom('allowlist_entries').selectAll().orderBy('id').execute(),
    db.selectFrom('pr_evaluations').selectAll().orderBy('id').execute(),
    db.selectFrom('audit_log').selectAll().orderBy('id').execute(),
    db.selectFrom('installation_admin_seen').selectAll().orderBy('installation_id').orderBy('user_github_id').execute(),
  ]);
  return JSON.stringify(tables);
}

/** The GitHub calls a role is read with: the only ones the guard ever makes (the port has no call that changes anything at GitHub). */
export const ROLE_READS: readonly string[] = ['getOrgMembership', 'getRepositoryPermission'];

/**
 * A response without what is per request (the request id, the date and the counters of the rate limit): its status, every
 * other header and its body byte for byte, with the request id replaced by a placeholder. Two answers are the same answer
 * when their shapes are equal.
 */
export function shapeOf(response: { statusCode: number; headers: Record<string, unknown>; body: string }) {
  const requestId = String(response.headers['x-request-id']);
  const perRequest = (name: string) => name === 'date' || name === 'x-request-id' || name.startsWith('x-ratelimit-');
  const headers = Object.fromEntries(Object.entries(response.headers).filter(([name]) => !perRequest(name)));
  return {
    status: response.statusCode,
    headers,
    body: response.body.replaceAll(requestId, '<request id>'),
  };
}

export type GuardWorld = Awaited<ReturnType<typeof guardWorld>>;

type LoggedIn = Awaited<ReturnType<AuthWorld['login']>>;

/** The session of `person`, chosen by name without indexing a record by a variable. */
function sessionOf(people: Readonly<Record<Person, LoggedIn>>, person: Person): LoggedIn {
  switch (person) {
    case 'admin1':
      return people.admin1;
    case 'repoAdmin1':
      return people.repoAdmin1;
    case 'repoAdminOther':
      return people.repoAdminOther;
    case 'member1':
      return people.member1;
    case 'outsider':
      return people.outsider;
    case 'admin2':
      return people.admin2;
    case 'owner':
      return people.owner;
  }
}

/** What `person` sends: the session cookie, and for a state-changing request the origin and the CSRF token too. */
function headersOf(people: Readonly<Record<Person, LoggedIn>>, person: Person, method: 'GET' | 'POST') {
  const session = sessionOf(people, person);
  return method === 'GET' ? { cookie: session.cookie } : session.headers;
}

/** The world described at the top of this file. */
export async function guardWorld() {
  const fake = new FakeGitHub();
  scriptGitHub(fake);
  const world = await authWorld({}, { github: fake });
  const stored = await seedTenants(world.db);
  const reached: string[] = [];
  addProbeRoutes(world, reached);
  const [admin1, repoAdmin1, repoAdminOther, member1, outsider, admin2, owner] = await Promise.all([
    world.login(PEOPLE.admin1),
    world.login(PEOPLE.repoAdmin1),
    world.login(PEOPLE.repoAdminOther),
    world.login(PEOPLE.member1),
    world.login(PEOPLE.outsider),
    world.login(PEOPLE.admin2),
    world.login(PEOPLE.owner),
  ]);
  const people = { admin1, repoAdmin1, repoAdminOther, member1, outsider, admin2, owner };
  /** A request as `person` would send it (nobody: no cookie). A `POST` carries the origin and token the app demands. */
  const ask = (method: 'GET' | 'POST', url: string, person?: Person) =>
    world.app.inject({
      method,
      url,
      ...(person === undefined ? {} : { headers: headersOf(people, person, method) }),
      ...(method === 'POST' ? { payload: {} } : {}),
    });
  /** How many statements a request of `person` sends: what one request that only needs the session costs (`/probe/protected`) is the floor. */
  const statementsOf = async (url: string, person: Person) => {
    const before = world.queries.length;
    await ask('GET', url, person);
    return world.queries.length - before;
  };
  return { ...world, ...stored, fake, reached, people, ask, statementsOf };
}
