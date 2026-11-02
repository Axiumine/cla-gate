// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { afterAll, expect, test, vi } from 'vitest';
import { z } from 'zod';
import type { Database } from '../adapters/db/schema.ts';
import { jobSchema } from '../domain/jobs.ts';
import type { Routing } from '../domain/webhook-routing-types.ts';
import { createTenantFilter } from './tenant-filter.ts';
import { TENANT, tenantDatabase } from './tenant-fixture/test-support.ts';
import { FakeClock } from './test-support.ts';

// What the filter logs (E06-S05): one WARN per installation per minute for a delivery it does not act on, numeric ids and
// a constant only. Nothing writes, so one database serves the whole file.

let shared: Promise<Kysely<Database>> | undefined;
afterAll(async () => {
  await (await shared)?.destroy();
});

const MINUTE = 60_000;

const routingOf = (installation: number, repository: number): Routing => ({
  kind: 'job',
  job: jobSchema.parse({
    type: 'evaluate-pr',
    trigger: 'pull_request',
    githubInstallationId: installation,
    githubRepoId: repository,
    prNumber: 7,
    deliveryId: '5b8f2c1e-3d4a-4f6b-9a7c-0e1d2f3a4b5c',
  }),
});

async function setup() {
  shared ??= tenantDatabase();
  const clock = new FakeClock('2026-06-01T12:00:00Z');
  const warn = vi.fn<(fields: object, message: string) => void>();
  return { filter: createTenantFilter({ db: await shared, clock }), clock, log: { warn }, warn };
}

const rejected = routingOf(TENANT.rejected.installation, TENANT.rejected.repository);

test('a rejected tenant is logged once, with its numeric ids and a constant reason', async () => {
  const { filter, log, warn } = await setup();
  await filter.admit(rejected, log);
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    {
      githubInstallationId: TENANT.rejected.installation,
      githubRepoId: TENANT.rejected.repository,
      reason: 'installation_not_admitted',
    },
    'webhook.tenant_refused',
  );
});

test('a rejected tenant that keeps sending is logged once a minute, not once a delivery', async () => {
  const { filter, clock, log, warn } = await setup();
  for (let delivery = 0; delivery < 50; delivery += 1) {
    await filter.admit(rejected, log);
  }
  expect(warn).toHaveBeenCalledTimes(1);
  clock.advance(MINUTE - 1);
  await filter.admit(rejected, log);
  expect(warn).toHaveBeenCalledTimes(1);
  clock.advance(1);
  await filter.admit(rejected, log);
  expect(warn).toHaveBeenCalledTimes(2);
});

test('the limit is per installation: a second rejected tenant in the same minute is logged too', async () => {
  const { filter, log, warn } = await setup();
  await filter.admit(rejected, log);
  await filter.admit(routingOf(TENANT.suspended.installation, TENANT.suspended.repository), log);
  await filter.admit(routingOf(TENANT.deleted.installation, TENANT.deleted.repository), log);
  await filter.admit(rejected, log);
  expect(warn.mock.calls.map(([fields]) => fields)).toMatchObject([
    { githubInstallationId: TENANT.rejected.installation, reason: 'installation_not_admitted' },
    { githubInstallationId: TENANT.suspended.installation, reason: 'installation_suspended' },
    { githubInstallationId: TENANT.deleted.installation, reason: 'installation_deleted' },
  ]);
});

test('a delivery that is replaced by a sync is logged the same way, under its own message', async () => {
  const { filter, log, warn } = await setup();
  await filter.admit(routingOf(TENANT.unknown.installation, TENANT.unknown.repository), log);
  await filter.admit(routingOf(TENANT.unknown.installation, TENANT.unknown.repository), log);
  await filter.admit(routingOf(TENANT.admitted.installation, TENANT.other.repository), log);
  expect(warn.mock.calls).toEqual([
    [
      {
        githubInstallationId: TENANT.unknown.installation,
        githubRepoId: TENANT.unknown.repository,
        reason: 'installation_unknown',
      },
      'webhook.tenant_redirected',
    ],
    [
      {
        githubInstallationId: TENANT.admitted.installation,
        githubRepoId: TENANT.other.repository,
        reason: 'repository_installation_mismatch',
      },
      'webhook.tenant_redirected',
    ],
  ]);
});

test('a tenant that is served, and a delivery that bypasses the filter, are never logged', async () => {
  const { filter, log, warn } = await setup();
  await filter.admit(routingOf(TENANT.admitted.installation, TENANT.admitted.repository), log);
  await filter.admit({ kind: 'pong' }, log);
  expect(warn).not.toHaveBeenCalled();
});

test('a log line holds numbers and constants only: no account, repository name or pull request text', async () => {
  const { filter, log, warn } = await setup();
  await filter.admit(rejected, log);
  const call = warn.mock.calls[0];
  const fields = z.record(z.string(), z.unknown()).parse(call?.[0]);
  expect(Object.values(fields).filter((value) => typeof value !== 'number')).toEqual(['installation_not_admitted']);
  expect(call?.[1]).toBe('webhook.tenant_refused');
  expect(JSON.stringify(fields)).not.toMatch(/account|repo|CANARY|@/);
});
