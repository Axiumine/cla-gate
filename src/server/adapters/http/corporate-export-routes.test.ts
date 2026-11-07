// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CORPORATE_AGREEMENTS_CSV_PATH, CORPORATE_APPROVALS_CSV_PATH } from '../../../shared/corporate-export.ts';
import { csvRecords } from '../../domain/csv-fixture/test-support.ts';
import { fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { approve } from '../db/corporate-fixture/test-support.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import {
  ADA_ID,
  type CorporateWorld,
  corporateWorld,
  failureOf,
  signAs,
  signedOf,
  signerWith,
} from './corporate-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';

// `GET /api/installations/:installationId/corporate-agreements.csv` and `.../approvals.csv` (E21-S05): who may download them, what the
// answer looks like, what a tenant's file holds, and the budget. The file itself, cell by cell, is in services/export.

const FILES = [
  ['corporate-agreements.csv', CORPORATE_AGREEMENTS_CSV_PATH, 'agreement_id', 'corporate-agreements', 1],
  ['approvals.csv', CORPORATE_APPROVALS_CSV_PATH, 'approval_id', 'corporate-approvals', 2],
] as const;

const urlOf = (template: string, installationId: number | string): string =>
  template.replace(':installationId', String(installationId));

/** Ada signs for tenant 1 with a company whose name is a formula, and Eve for tenant 2; each tenant approves a person of its own. */
async function twoTenantWorld() {
  const world = await corporateWorld({}, { enqueuer: fakeEnqueuer() });
  const eve = await signerWith(world, 4321);
  const ada = await signAs(world, world.ada, world.c1, { companyName: '=HYPERLINK("http://x","y")' });
  const eves = await signAs(world, eve, world.c2, { companyName: 'Eve Ltd' });
  await approve(world.db, signedOf(world.c1, world.ada, ada), { kind: 'user', githubId: 7001, login: 'employee-one' });
  await approve(world.db, signedOf(world.c2, eve, eves), { kind: 'user', githubId: 7002, login: 'employee-two' });
  return { world, ada, eves };
}

/** The checksums of every tenant table but the one that notes when an admin was last seen, which every successful guard of an admin refreshes. */
async function checksumsWithoutAdminVisits(world: CorporateWorld) {
  return Object.entries(await tenantChecksums(world.db)).filter(([table]) => table !== 'installation_admin_seen');
}

const download = (world: CorporateWorld, who: Parameters<CorporateWorld['ask']>[0], template: string, id: number) =>
  world.ask(who, { method: 'GET', url: urlOf(template, id) });

test.each(FILES.map(([name, template, idColumn, prefix, rows]) => ({ name, template, idColumn, prefix, rows })))(
  'an org admin downloads $name: a CSV attachment named from the kind and the date, not cached, with the rows of their tenant',
  async ({ template, idColumn, prefix, rows }) => {
    const { world } = await twoTenantWorld();
    const response = await download(world, 'admin1', template, world.t1.installationId);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(`attachment; filename="${prefix}-2026-11-02.csv"`);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-length']).toBeUndefined();
    expect(response.rawPayload.subarray(0, idColumn.length).toString('utf8')).toBe(idColumn);
    expect(csvRecords(response.body)).toHaveLength(rows);
  },
);

test('the agreements of a tenant name its companies and signatories, guarded, and the other tenant has none of them', async () => {
  const { world, ada, eves } = await twoTenantWorld();
  const first = csvRecords(
    (await download(world, 'admin1', CORPORATE_AGREEMENTS_CSV_PATH, world.t1.installationId)).body,
  );
  const second = csvRecords(
    (await download(world, 'admin2', CORPORATE_AGREEMENTS_CSV_PATH, world.t2.installationId)).body,
  );
  expect(first).toEqual([
    {
      agreement_id: String(ada.id),
      signed_at: ada.signedAt,
      major: '1',
      company_name: `'=HYPERLINK("http://x","y")`,
      signatory_github_id: String(ADA_ID),
      signatory_login: `login-${ADA_ID}`,
      revoked: 'false',
    },
  ]);
  expect(second.map((record) => [record['agreement_id'], record['company_name']])).toEqual([
    [String(eves.id), 'Eve Ltd'],
  ]);
});

test('the approvals of a tenant are the approvals of its agreements by numeric id, and the other tenant has none of them', async () => {
  const { world, ada, eves } = await twoTenantWorld();
  const first = csvRecords(
    (await download(world, 'admin1', CORPORATE_APPROVALS_CSV_PATH, world.t1.installationId)).body,
  );
  const second = csvRecords(
    (await download(world, 'admin2', CORPORATE_APPROVALS_CSV_PATH, world.t2.installationId)).body,
  );
  expect(first.map((record) => [record['agreement_id'], record['kind'], record['subject'], record['source']])).toEqual([
    [String(ada.id), 'user', String(ADA_ID), 'manager'],
    [String(ada.id), 'user', '7001', 'manager'],
  ]);
  expect(second.map((record) => [record['agreement_id'], record['subject']])).toEqual([
    [String(eves.id), '4321'],
    [String(eves.id), '7002'],
  ]);
});

test.each(FILES)(
  'for %s the admin of one repository is a 403, a member and a stranger a 404, the admin of another tenant a 404, and nobody a 401',
  async (_name, template) => {
    const { world } = await twoTenantWorld();
    const answers = [
      await download(world, 'repoAdmin1', template, world.t1.installationId),
      await download(world, 'member1', template, world.t1.installationId),
      await download(world, 'outsider', template, world.t1.installationId),
      await download(world, 'admin2', template, world.t1.installationId),
      await download(world, null, template, world.t1.installationId),
    ];
    expect(answers.map(failureOf)).toEqual([
      [403, 'forbidden'],
      [404, 'not_found'],
      [404, 'not_found'],
      [404, 'not_found'],
      [401, 'unauthorized'],
    ]);
  },
);

test.each(FILES)(
  'for %s an installation that does not exist is the same 404 as one of another tenant',
  async (_name, template) => {
    const { world } = await twoTenantWorld();
    const unknown = await download(world, 'admin1', template, 987_654);
    const foreign = await download(world, 'admin1', template, world.t2.installationId);
    expect([failureOf(unknown), failureOf(foreign)]).toEqual([
      [404, 'not_found'],
      [404, 'not_found'],
    ]);
    expect(foreign.body.replace(/"requestId":"[^"]+"/, '')).toBe(unknown.body.replace(/"requestId":"[^"]+"/, ''));
  },
);

test.each(FILES)('for %s an installation id that is not a positive integer is a 400', async (_name, template) => {
  const { world } = await twoTenantWorld();
  for (const id of ['abc', '0', '-1', '01']) {
    const response = await world.ask('admin1', { method: 'GET', url: urlOf(template, id) });
    expect(response.statusCode, id).toBe(400);
  }
});

test.each(FILES)('for %s a suspended tenant is served: it is a read', async (_name, template) => {
  const { world } = await twoTenantWorld();
  await suspendTenantOne(world);
  expect((await download(world, 'admin1', template, world.t1.installationId)).statusCode).toBe(200);
});

test.each(FILES)('for %s a query string the route does not define is a 400', async (_name, template) => {
  const { world } = await twoTenantWorld();
  const response = await world.ask('admin1', {
    method: 'GET',
    url: `${urlOf(template, world.t1.installationId)}?limit=10`,
  });
  expect(failureOf(response)).toEqual([400, 'bad_request']);
});

test('a refused or invalid call changes no row of any tenant table: not even an audit row, which only a file that was sent leaves', async () => {
  const { world } = await twoTenantWorld();
  const before = await checksumsWithoutAdminVisits(world);
  await download(world, 'admin2', CORPORATE_APPROVALS_CSV_PATH, world.t1.installationId);
  await download(world, null, CORPORATE_AGREEMENTS_CSV_PATH, world.t1.installationId);
  await world.ask('admin1', {
    method: 'GET',
    url: `${urlOf(CORPORATE_AGREEMENTS_CSV_PATH, world.t1.installationId)}?limit=10`,
  });
  expect(await checksumsWithoutAdminVisits(world)).toEqual(before);
});

test.each(FILES)('for %s the seventh request of a minute is a 429 for that person alone', async (_name, template) => {
  const { world } = await twoTenantWorld();
  const statuses: number[] = [];
  for (let request = 0; request < 7; request += 1) {
    statuses.push((await download(world, 'admin1', template, world.t1.installationId)).statusCode);
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  expect(failureOf(await download(world, 'admin1', template, world.t1.installationId))).toEqual([
    429,
    'too_many_requests',
  ]);
  expect((await download(world, 'admin2', template, world.t2.installationId)).statusCode).toBe(200);
});
