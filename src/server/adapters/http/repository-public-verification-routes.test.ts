// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { auditRows, errorCodeOf, tablesOf, withoutRequestId } from './document-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';
import {
  optInAnswerOf,
  optInAs,
  optInAt,
  optInAuditRows,
  optInState,
  optInWorld,
  ownDocumentOnScoped,
} from './repository-public-verification-fixture/test-support.ts';

// PUT /api/installations/:installationId/repositories/:repositoryId/public-verification (E22-S02): who may turn the public signature check
// on or off for a repository, what the call stores and audits, and what it refuses. The other tenant's ids and the race are in
// repository-public-verification-tenants.test.ts.

test('the org admin turns the check on: 200 changed, the flag moves, one audit row of ids and a flag, nothing cached', async () => {
  const world = await optInWorld();
  const { t1, people } = world;
  const before = await optInState(world, t1.plain.repositoryId);
  expect(before.public_verification).toBe(false);
  const response = await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(optInAnswerOf(response)).toEqual({ enabled: true, changed: true });
  const after = await optInState(world, t1.plain.repositoryId);
  expect(after.public_verification).toBe(true);
  expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  const audit = await optInAuditRows(world, t1.plain.githubRepoId);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    subject_type: 'repository',
    subject_id: t1.plain.githubRepoId,
    metadata: { repository_id: t1.plain.repositoryId, enabled: true },
  });
  expect(Object.keys(audit[0]?.metadata ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
    'enabled',
    'repository_id',
  ]);
});

test('the org admin turns the check off again: a second change, a second audit row that says enabled false', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  const off = await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: false });
  expect([off.statusCode, optInAnswerOf(off)]).toEqual([200, { enabled: false, changed: true }]);
  expect((await optInState(world, t1.plain.repositoryId)).public_verification).toBe(false);
  const audit = await optInAuditRows(world, t1.plain.githubRepoId);
  expect(audit.map((row) => row.metadata)).toEqual([
    { repository_id: t1.plain.repositoryId, enabled: true },
    { repository_id: t1.plain.repositoryId, enabled: false },
  ]);
});

test('a call that asks for what already is answers changed false and writes nothing: no audit row, no new updated_at', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  const audited = (await auditRows(world, 'repository.public_verification_changed')).length;
  const before = await optInState(world, t1.plain.repositoryId);
  const off = await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: false });
  expect([off.statusCode, optInAnswerOf(off)]).toEqual([200, { enabled: false, changed: false }]);
  await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  const stored = await optInState(world, t1.plain.repositoryId);
  const on = await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  expect([on.statusCode, optInAnswerOf(on)]).toEqual([200, { enabled: true, changed: false }]);
  expect((await optInState(world, t1.plain.repositoryId)).updated_at).toEqual(stored.updated_at);
  expect(before.updated_at.getTime()).toBeLessThan(stored.updated_at.getTime());
  expect(await auditRows(world, 'repository.public_verification_changed')).toHaveLength(audited + 1);
});

test('the call changes the flag and the audit log and nothing else, in any tenant', async () => {
  const world = await optInWorld();
  const before = await tablesOf(world);
  await optInAs(world, 'admin1', world.t1.plain.repositoryId, { enabled: true });
  const after = await tablesOf(world);
  const was = new Map(Object.entries(before));
  const changed = Object.entries(after).filter(([table, now]) => now.checksum !== was.get(table)?.checksum);
  expect(changed.map(([table]) => table).toSorted((a, b) => a.localeCompare(b))).toEqual(['audit_log', 'repositories']);
});

test('the call works on a repository that does not enforce anything yet, and sends no request to GitHub', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  const response = await optInAs(world, 'admin1', t1.plain.repositoryId, { enabled: true });
  expect(optInAnswerOf(response).changed).toBe(true);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('the admin of a repository whose own CLA is attached changes the settings of that repository, and the audit row names them', async () => {
  const world = await optInWorld();
  const { t1, people } = world;
  await ownDocumentOnScoped(world);
  const response = await optInAs(world, 'repoAdmin1', t1.scoped.repositoryId, { enabled: true });
  expect([response.statusCode, optInAnswerOf(response)]).toEqual([200, { enabled: true, changed: true }]);
  const [audit] = await optInAuditRows(world, t1.scoped.githubRepoId);
  expect(audit).toMatchObject({ actor_github_id: people.repoAdmin1.githubId, installation_id: t1.installationId });
});

test('the org admin changes the settings of a repository that has its own CLA: an org admin passes both requirements', async () => {
  const world = await optInWorld();
  await ownDocumentOnScoped(world);
  const response = await optInAs(world, 'admin1', world.t1.scoped.repositoryId, { enabled: true });
  expect(optInAnswerOf(response).changed).toBe(true);
});

test('the admin of a repository is 403 forbidden for a repository whose document covers the installation or is none, and no row changes', async () => {
  const world = await optInWorld();
  const { t1 } = world;
  const before = await tablesOf(world);
  const noDocument = await optInAs(world, 'repoAdmin1', t1.scoped.repositoryId, { enabled: true });
  const another = await optInAs(world, 'repoAdmin1', t1.plain.repositoryId, { enabled: true });
  expect([noDocument.statusCode, errorCodeOf(noDocument)]).toEqual([403, 'forbidden']);
  expect([another.statusCode, errorCodeOf(another)]).toEqual([403, 'forbidden']);
  expect(await tablesOf(world)).toEqual(before);
});

test('a person with no role in the installation gets the 404 of an unknown repository, byte for byte, and no row changes', async () => {
  const world = await optInWorld();
  const unknown = await optInAs(world, 'admin1', 987_654, { enabled: true });
  const before = await tablesOf(world);
  const answers = [
    await optInAs(world, 'member1', world.t1.plain.repositoryId, { enabled: true }),
    await optInAs(world, 'outsider', world.t1.plain.repositoryId, { enabled: true }),
    await optInAs(world, 'admin2', world.t1.plain.repositoryId, { enabled: true }),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([404, 404, 404]);
  expect(answers.map(withoutRequestId)).toEqual(answers.map(() => withoutRequestId(unknown)));
  expect(await tablesOf(world)).toEqual(before);
});

test('a person with no session gets 401, and nothing changes', async () => {
  const world = await optInWorld();
  const before = await tablesOf(world);
  const response = await optInAs(world, null, world.t1.plain.repositoryId, { enabled: true });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([401, 'unauthorized']);
  expect(await tablesOf(world)).toEqual(before);
});

test.each([
  ['an empty object', {}],
  ['a flag that is a string', { enabled: 'true' }],
  ['a flag that is a number', { enabled: 1 }],
  ['a flag that is null', { enabled: null }],
  ['a key nobody defined', { enabled: true, installationId: 1 }],
  ['an array', [true]],
])('a body that is %s is a 400 and changes nothing', async (_label, body) => {
  const world = await optInWorld();
  const before = await tablesOf(world);
  const response = await optInAs(world, 'admin1', world.t1.plain.repositoryId, body);
  expect(response.statusCode).toBe(400);
  expect(await tablesOf(world)).toEqual(before);
});

test('ids that are not ids are 400 before anything is read, and an unknown repository is 404', async () => {
  const world = await optInWorld();
  const garbage = await optInAs(world, 'admin1', '0x10', { enabled: true });
  const badInstallation = await optInAt(
    world,
    'admin1',
    { installationId: 'abc', repositoryId: world.t1.plain.repositoryId },
    { enabled: true },
  );
  const unknown = await optInAs(world, 'admin1', 987_654, { enabled: true });
  expect([garbage.statusCode, badInstallation.statusCode, unknown.statusCode]).toEqual([400, 400, 404]);
});

test('a suspended installation refuses the call with 409 installation_suspended, also for the org admin the ledger remembers, and changes nothing', async () => {
  const world = await optInWorld();
  await suspendTenantOne(world);
  const before = await tablesOf(world);
  const response = await optInAs(world, 'admin1', world.t1.plain.repositoryId, { enabled: true });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
  expect(await tablesOf(world)).toEqual(before);
  expect(await optInAuditRows(world, world.t1.plain.githubRepoId)).toEqual([]);
});
