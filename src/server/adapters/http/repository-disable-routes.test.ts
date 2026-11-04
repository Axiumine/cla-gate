// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { jobCount, sentJobs, setJobStates } from '../../services/jobs-fixture/test-support.ts';
import { auditRows, parsed, tablesOf } from './document-fixture/test-support.ts';
import {
  disableAs,
  disabledAnswerOf,
  disabledAuditRows,
  disablePath,
  disableWorld,
  finalisations,
} from './repository-disable-fixture/test-support.ts';
import { repositoryState, setEnabled } from './repository-document-fixture/test-support.ts';

// POST /api/repositories/:repositoryId/disable (E14-S04): who may turn enforcement off and what the call stores, audits and sends,
// on the real application over PGlite. The roles that refuse a call are in repository-disable-rules.test.ts, the failures of the
// queue in repository-disable-jobs.test.ts, the other tenant's ids in repository-disable-tenants.test.ts, the race in
// repository-disable-race.test.ts.

test('the org admin turns enforcement off: 200 changed, the flag moves, one audit row, one finalise job, nothing cached', async () => {
  const world = await disableWorld();
  const { t1, people } = world;
  const before = await repositoryState(world, t1.plain.repositoryId);
  const response = await disableAs(world, 'admin1', t1.plain.repositoryId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(disabledAnswerOf(response)).toEqual({ enabled: false, changed: true });
  const after = await repositoryState(world, t1.plain.repositoryId);
  expect(after.enabled).toBe(false);
  expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  const audit = await disabledAuditRows(world, t1.plain.githubRepoId);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    subject_type: 'repository',
    metadata: { repository_id: t1.plain.repositoryId },
  });
  expect(await finalisations(world)).toHaveLength(1);
});

test('the job is the finalise-repository job of E07-S09: the numeric ids of the envelope and a key that names this change', async () => {
  const world = await disableWorld();
  const { t1 } = world;
  await disableAs(world, 'admin1', t1.plain.repositoryId);
  const stored = await repositoryState(world, t1.plain.repositoryId);
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `finalise-repository:${t1.plain.githubRepoId}:${stored.updated_at.getTime()}`,
      dedupeKey: null,
      job: {
        type: 'finalise-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
      },
    },
  ]);
});

test('the call keeps the CLA document, the signatures, the allowlist and every evaluation: the flag is the one change besides the audit row', async () => {
  const world = await disableWorld();
  const { t1 } = world;
  const before = await tablesOf(world);
  await disableAs(world, 'admin1', t1.plain.repositoryId);
  const after = await tablesOf(world);
  const was = new Map(Object.entries(before));
  const changed = Object.entries(after).filter(([table, now]) => now.checksum !== was.get(table)?.checksum);
  expect(changed.map(([table]) => table).toSorted((a, b) => a.localeCompare(b))).toEqual(['audit_log', 'repositories']);
  expect(after['repositories']?.rows).toBe(before['repositories']?.rows);
  expect(after['pr_evaluations']?.rows).toBe(before['pr_evaluations']?.rows);
  expect((await repositoryState(world, t1.plain.repositoryId)).cla_document_id).toBe(t1.documentId);
});

test('the admin of a repository turns off the repository whose own CLA is attached', async () => {
  const world = await disableWorld();
  const { t1, people } = world;
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: t1.scoped.documentId, enabled: true })
    .where('id', '=', t1.scoped.repositoryId)
    .execute();
  const response = await disableAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect([response.statusCode, disabledAnswerOf(response)]).toEqual([200, { enabled: false, changed: true }]);
  expect((await repositoryState(world, t1.scoped.repositoryId)).enabled).toBe(false);
  const [audit] = await disabledAuditRows(world, t1.scoped.githubRepoId);
  expect(audit).toMatchObject({ actor_github_id: people.repoAdmin1.githubId });
});

test('the org admin turns off a repository that has no document attached: nothing is needed but the role', async () => {
  const world = await disableWorld();
  const { t1 } = world;
  const response = await disableAs(world, 'admin1', t1.scoped.repositoryId);
  expect([response.statusCode, disabledAnswerOf(response)]).toEqual([200, { enabled: false, changed: true }]);
});

test('a repository that is off already answers 200 changed false and writes no audit row and sends no job', async () => {
  const world = await disableWorld();
  const { t1 } = world;
  await disableAs(world, 'admin1', t1.plain.repositoryId);
  const audited = (await auditRows(world, 'repository.disabled')).length;
  const stored = await repositoryState(world, t1.plain.repositoryId);
  const again = await disableAs(world, 'admin1', t1.plain.repositoryId);
  expect([again.statusCode, disabledAnswerOf(again)]).toEqual([200, { enabled: false, changed: false }]);
  expect(await auditRows(world, 'repository.disabled')).toHaveLength(audited);
  expect(await jobCount(world.db)).toBe(1);
  expect((await repositoryState(world, t1.plain.repositoryId)).updated_at).toEqual(stored.updated_at);
});

test('a repository that was never on answers changed false too, with no side effect at all', async () => {
  const world = await disableWorld();
  await setEnabled(world, world.t1.plain.repositoryId, false);
  const before = await tablesOf(world);
  const response = await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([response.statusCode, disabledAnswerOf(response)]).toEqual([200, { enabled: false, changed: false }]);
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
});

test('turning off, on and off again is three changes and each off is finalised, under keys of their own', async () => {
  const world = await disableWorld();
  const { t1 } = world;
  await disableAs(world, 'admin1', t1.plain.repositoryId);
  await setJobStates(world.db, 'completed');
  await setEnabled(world, t1.plain.repositoryId, true);
  const again = await disableAs(world, 'admin1', t1.plain.repositoryId);
  expect(disabledAnswerOf(again).changed).toBe(true);
  const keys = (await finalisations(world)).map((sent) => sent.idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(2);
  expect(await disabledAuditRows(world, t1.plain.githubRepoId)).toHaveLength(2);
});

test.each([
  ['no body at all', undefined],
  ['an empty object', {}],
])('a call with %s is accepted', async (_label, payload) => {
  const world = await disableWorld();
  const session = await world.login(world.people.admin1.githubId);
  const response = await world.app.inject({
    method: 'POST',
    url: disablePath(world.t1.plain.repositoryId),
    headers: session.headers,
    ...(payload === undefined ? {} : { payload }),
  });
  expect([response.statusCode, disabledAnswerOf(response).changed]).toEqual([200, true]);
});

test.each([
  ['a key nobody defined', { installationId: 1 }],
  ['a document id', { documentId: 7 }],
  ['a flag', { enabled: true }],
])('a body with %s is a 400 and changes nothing', async (_label, body) => {
  const world = await disableWorld();
  const before = await tablesOf(world);
  const response = await disableAs(world, 'admin1', world.t1.plain.repositoryId, body);
  expect([response.statusCode, parsed(response, errorResponseSchema).error.code]).toEqual([400, 'bad_request']);
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
});

test('a person with no session gets 401 and an id that is not an id gets 400, before anything is read', async () => {
  const world = await disableWorld();
  const anonymous = await disableAs(world, null, world.t1.plain.repositoryId);
  const garbage = await disableAs(world, 'admin1', '0x10');
  expect([anonymous.statusCode, garbage.statusCode]).toEqual([401, 400]);
  expect(parsed(garbage, errorResponseSchema).error.code).toBe('bad_request');
});

test('a repository that is removed or does not exist is the 404 of an unknown id', async () => {
  const world = await disableWorld();
  const unknown = await disableAs(world, 'admin1', 987_654);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
  const removed = await disableAs(world, 'admin1', world.t1.plain.repositoryId);
  expect([unknown.statusCode, removed.statusCode]).toEqual([404, 404]);
  expect(await jobCount(world.db)).toBe(0);
});
