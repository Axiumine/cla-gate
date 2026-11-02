// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { afterAll, expect, test, vi } from 'vitest';
import type { Database } from '../adapters/db/schema.ts';
import { type Job, jobSchema } from '../domain/jobs.ts';
import type { Routing } from '../domain/webhook-routing-types.ts';
import { createTenantFilter } from './tenant-filter.ts';
import { countingDatabase, TENANT, tenantDatabase, UNSTORED_REPOSITORY } from './tenant-fixture/test-support.ts';
import { FakeClock } from './test-support.ts';

// The tenant and admission filter over the stored installations (E06-S05): three installations (admitted, rejected,
// suspended) plus a deleted one, a second admitted tenant a repository can be stored under, and one the database does not
// know. Nothing writes, so one database serves the whole file.

let shared: Promise<Kysely<Database>> | undefined;
afterAll(async () => {
  await (await shared)?.destroy();
});
function world(): Promise<Kysely<Database>> {
  shared ??= tenantDatabase();
  return shared;
}

const DELIVERY = '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c';
const SHA = '3f9a1c0b7d2e4a65b8c1d0e9f7a6b5c4d3e2f1a0';

type TenantJobType = 'evaluate-pr' | 'evaluate-head-sha' | 'close-pr' | 'recheck-comment';
const TENANT_JOB_TYPES: readonly TenantJobType[] = ['evaluate-pr', 'evaluate-head-sha', 'close-pr', 'recheck-comment'];

/** The job of `type` for the ids a payload named, as the router builds it. */
function jobOf(type: TenantJobType, installation: number, repository: number): Job {
  const ids = {
    githubInstallationId: installation,
    githubRepoId: repository,
    deliveryId: DELIVERY,
  };
  const jobs = {
    'evaluate-pr': { type, trigger: 'pull_request', prNumber: 7, ...ids },
    'evaluate-head-sha': { type, headSha: SHA, ...ids },
    'close-pr': { type, prNumber: 7, ...ids },
    'recheck-comment': { type, prNumber: 7, commentId: 90_004, ...ids },
  } as const;
  // eslint-disable-next-line security/detect-object-injection -- type is the closed TenantJobType union, never user input
  return jobSchema.parse(jobs[type]);
}

const routingOf = (type: TenantJobType, installation: number, repository: number): Routing => ({
  kind: 'job',
  job: jobOf(type, installation, repository),
});

const SYNC = (installation: number) => ({
  type: 'sync-installation',
  githubInstallationId: installation,
  deliveryId: DELIVERY,
});

const log = () => ({ warn: vi.fn<(fields: object, message: string) => void>() });

async function filterOver() {
  const counted = countingDatabase(await world());
  const clock = new FakeClock('2026-06-01T12:00:00Z');
  return { filter: createTenantFilter({ db: counted.db, clock }), statements: counted.statements, clock };
}

interface Case {
  readonly title: string;
  readonly installation: number;
  readonly repository: number;
  /** What the delivery becomes: `routing` is the job as it was. */
  readonly outcome: 'routing' | object;
  readonly statements: number;
}

const CASES: readonly Case[] = [
  {
    title: 'an admitted, active installation',
    installation: TENANT.admitted.installation,
    repository: TENANT.admitted.repository,
    outcome: 'routing',
    statements: 2,
  },
  {
    title: 'an admitted installation and a repository that is not stored yet',
    installation: TENANT.admitted.installation,
    repository: UNSTORED_REPOSITORY,
    outcome: 'routing',
    statements: 2,
  },
  {
    title: 'a rejected installation',
    installation: TENANT.rejected.installation,
    repository: TENANT.rejected.repository,
    outcome: { kind: 'ignored', reason: 'installation_not_admitted' },
    statements: 1,
  },
  {
    title: 'a suspended installation',
    installation: TENANT.suspended.installation,
    repository: TENANT.suspended.repository,
    outcome: { kind: 'ignored', reason: 'installation_suspended' },
    statements: 1,
  },
  {
    title: 'a deleted installation',
    installation: TENANT.deleted.installation,
    repository: TENANT.deleted.repository,
    outcome: { kind: 'ignored', reason: 'installation_deleted' },
    statements: 1,
  },
  {
    title: 'an installation the database does not know',
    installation: TENANT.unknown.installation,
    repository: TENANT.unknown.repository,
    outcome: { kind: 'redirected', reason: 'installation_unknown', job: SYNC(TENANT.unknown.installation) },
    statements: 1,
  },
  {
    title: 'installation A with a repository that is stored under B',
    installation: TENANT.admitted.installation,
    repository: TENANT.other.repository,
    outcome: {
      kind: 'redirected',
      reason: 'repository_installation_mismatch',
      job: SYNC(TENANT.admitted.installation),
    },
    statements: 2,
  },
  {
    title: 'installation B with a repository that is stored under A',
    installation: TENANT.other.installation,
    repository: TENANT.admitted.repository,
    outcome: {
      kind: 'redirected',
      reason: 'repository_installation_mismatch',
      job: SYNC(TENANT.other.installation),
    },
    statements: 2,
  },
];

/** Every case for every event type that becomes a job of a tenant's repository. */
const ROWS = TENANT_JOB_TYPES.flatMap((type) => CASES.map((row) => ({ type, ...row })));

test.each(ROWS)('$type of $title', async ({ type, installation, repository, outcome, statements: expected }) => {
  const { filter, statements } = await filterOver();
  const routing = routingOf(type, installation, repository);
  expect(await filter.admit(routing, log())).toEqual(outcome === 'routing' ? routing : outcome);
  expect(statements).toHaveLength(expected);
});

test('an installation that is not served is decided by its own row: its repository is never read', async () => {
  const { filter, statements } = await filterOver();
  const stolen = routingOf('evaluate-pr', TENANT.rejected.installation, TENANT.admitted.repository);
  expect(await filter.admit(stolen, log())).toEqual({ kind: 'ignored', reason: 'installation_not_admitted' });
  expect(statements).toEqual(['SelectQueryNode']);
});

test.each([
  ['a ping', { kind: 'pong' }],
  ['an ignored delivery', { kind: 'ignored', reason: 'unsupported_action' }],
  [
    'a sync-installation job, which is how a rejected account is recorded',
    { kind: 'job', job: jobSchema.parse(SYNC(TENANT.rejected.installation)) },
  ],
  [
    'a revoke-user-sessions job',
    { kind: 'job', job: jobSchema.parse({ type: 'revoke-user-sessions', githubUserId: 7_008, deliveryId: DELIVERY }) },
  ],
] as const)('%s bypasses the filter: it is returned as it is and nothing is read', async (_title, routing) => {
  const { filter, statements } = await filterOver();
  const logged = log();
  expect(await filter.admit(routing, logged)).toBe(routing);
  expect(statements).toEqual([]);
  expect(logged.warn).not.toHaveBeenCalled();
});

test('the largest GitHub id is a number the database compares exactly, for an installation and for a repository', async () => {
  const { filter } = await filterOver();
  const largest = Number.MAX_SAFE_INTEGER;
  expect(await filter.admit(routingOf('evaluate-pr', largest, largest), log())).toMatchObject({
    kind: 'redirected',
    reason: 'installation_unknown',
  });
  const known = routingOf('evaluate-pr', TENANT.admitted.installation, largest);
  expect(await filter.admit(known, log())).toBe(known);
});

test('a failing read is not caught: the delivery fails instead of letting a tenant through unchecked', async () => {
  const db = await world();
  const broken = db.withPlugin({
    transformQuery: () => {
      throw new Error('the database is down');
    },
    transformResult: ({ result }) => Promise.resolve(result),
  });
  const filter = createTenantFilter({ db: broken, clock: new FakeClock('2026-06-01T12:00:00Z') });
  const routing = routingOf('evaluate-pr', TENANT.admitted.installation, TENANT.admitted.repository);
  await expect(filter.admit(routing, log())).rejects.toThrow('the database is down');
});

test('it never reaches for GitHub: no request is sent for any decision', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  const { filter } = await filterOver();
  for (const row of CASES) {
    await filter.admit(routingOf('evaluate-pr', row.installation, row.repository), log());
  }
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

test.each([1, 2, 3, 4, 5])(
  'the installation row id %i is not a GitHub installation id: a payload that names it finds no tenant',
  async (rowId) => {
    const { filter } = await filterOver();
    const routing = routingOf('evaluate-pr', rowId, TENANT.admitted.repository);
    expect(await filter.admit(routing, log())).toMatchObject({ kind: 'redirected', reason: 'installation_unknown' });
  },
);

test('enforcement and removal are not checked here: the job re-checks them, so an event that came first is not lost', async () => {
  const db = await tenantDatabase();
  const clock = new FakeClock('2026-06-01T12:00:00Z');
  const filter = createTenantFilter({ db, clock });
  const routing = routingOf('evaluate-pr', TENANT.admitted.installation, TENANT.admitted.repository);
  const stored = () =>
    db
      .selectFrom('repositories')
      .select(['enabled', 'removed_at'])
      .where('github_repo_id', '=', TENANT.admitted.repository)
      .execute();
  expect(await stored()).toEqual([{ enabled: false, removed_at: null }]);
  expect(await filter.admit(routing, log())).toBe(routing);
  await db
    .updateTable('repositories')
    .set({ enabled: true })
    .where('github_repo_id', '=', TENANT.admitted.repository)
    .execute();
  expect(await filter.admit(routing, log())).toBe(routing);
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-06-01T12:00:00Z') })
    .where('github_repo_id', '=', TENANT.admitted.repository)
    .execute();
  expect(await filter.admit(routing, log())).toBe(routing);
  await db.destroy();
});
