// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { findTenantRows } from '../../services/tenant-queries.ts';
import { twoTenants } from './tenant-fixture/test-support.ts';
import { attempt, ownersOfTenantRows, type ScopedQuery, TENANT_QUERIES } from './tenant-registry/test-support.ts';
import { migratedTestDatabase } from './test-support.ts';

// The helpers of the registry (E11-S06): what `attempt` makes of a call, and what an answer of the guard's read says about
// whose rows it holds.

async function world() {
  const { db } = await migratedTestDatabase();
  return { db, ...(await twoTenants(db)) };
}

class Refused extends Error {}

const answering = (owners: readonly number[]): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  run: () => Promise.resolve(owners),
});

const failing = (error: Error, refusal?: ScopedQuery['refusal']): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  ...(refusal === undefined ? {} : { refusal }),
  run: () => Promise.reject(error),
});

test('an answer is the owners of its rows', async () => {
  const { db, t1 } = await world();
  expect(await attempt(answering([1, 2]), db, { installationId: t1.installationId }, t1)).toEqual({
    kind: 'rows',
    owners: [1, 2],
  });
});

test('an error the entry names as its refusal is the outcome refused', async () => {
  const { db, t1 } = await world();
  const query = failing(new Refused('no'), (error) => error instanceof Refused);
  expect(await attempt(query, db, { installationId: t1.installationId }, t1)).toEqual({ kind: 'refused' });
});

test('any other error is thrown, so a defect is not mistaken for a denial', async () => {
  const { db, t1 } = await world();
  const scope = { installationId: t1.installationId };
  const notRefusal = failing(new Error('bug'), (error) => error instanceof Refused);
  await expect(attempt(notRefusal, db, scope, t1)).rejects.toThrow('bug');
  await expect(attempt(failing(new Refused('no')), db, scope, t1)).rejects.toThrow('no');
});

test('the unique violation of the database is the refusal of writeChanged, and nothing else is', () => {
  const entry = TENANT_QUERIES['services/repository-statements.ts']?.['writeChanged'];
  expect(entry?.kind).toBe('scoped');
  const refusal = entry?.kind === 'scoped' ? entry.refusal : undefined;
  expect(refusal?.(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBe(true);
  expect(refusal?.(Object.assign(new Error('other'), { code: '23503' }))).toBe(false);
  expect(refusal?.(new Error('no code'))).toBe(false);
  expect(refusal?.('23505')).toBe(false);
  expect(refusal?.(null)).toBe(false);
});

test('the rows of a tenant read are owned by the installation and the repository', async () => {
  const { db, t1, t2 } = await world();
  const rows = await findTenantRows(db, { installationId: t1.installationId }, t1.plain.repositoryId);
  expect(ownersOfTenantRows(rows)).toEqual([t1.installationId, t1.installationId]);
  expect(
    ownersOfTenantRows(await findTenantRows(db, { installationId: t1.installationId }, t2.plain.repositoryId)),
  ).toEqual([]);
});

test('a read that answers an installation with no repository is refused: the registry always asks for one', async () => {
  const { db, t1 } = await world();
  const installationOnly = await findTenantRows(db, { installationId: t1.installationId }, null);
  expect(() => ownersOfTenantRows(installationOnly)).toThrow('the registry asks for a repository');
});

test('turning a repository on is answered with its owner once, and with nothing when it is already on', async () => {
  const { db, t1 } = await world();
  const entry = TENANT_QUERIES['services/repository-enabled.ts']?.['setRepositoryEnabled'];
  expect(entry?.kind).toBe('scoped');
  const scope = { installationId: t1.installationId };
  const first = entry?.kind === 'scoped' ? await entry.run(db, scope, t1) : undefined;
  const second = entry?.kind === 'scoped' ? await entry.run(db, scope, t1) : undefined;
  expect([first, second]).toEqual([[t1.installationId], []]);
});
