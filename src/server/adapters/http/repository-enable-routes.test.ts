// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { sweepRepositoryCoalesceKey } from '../../domain/repository-jobs.ts';
import { jobCount, sentJobs, setJobStates } from '../../services/jobs-fixture/test-support.ts';
import { auditRows, errorCodeOf, parsed, tablesOf } from './document-fixture/test-support.ts';
import { repositoryState, setEnabled } from './repository-document-fixture/test-support.ts';
import {
  enableAs,
  enabledAnswerOf,
  enabledAuditRows,
  enablePath,
  enableWorld,
  readyScoped,
  sweeps,
} from './repository-enable-fixture/test-support.ts';

// POST /api/repositories/:repositoryId/enable (E14-S03): who may turn enforcement on and what the call stores, audits and sends, on the
// real application over PGlite. The rules that refuse a call are in repository-enable-rules.test.ts, the failures of the queue in
// repository-enable-jobs.test.ts, the other tenant's ids in repository-enable-tenants.test.ts, the race in repository-enable-race.test.ts.

test('the org admin turns enforcement on for a repository with a published CLA: 200 changed, the flag moves, one audit row, one sweep, nothing cached', async () => {
  const world = await enableWorld();
  const { t1, people } = world;
  const before = await repositoryState(world, t1.plain.repositoryId);
  const response = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(enabledAnswerOf(response)).toEqual({ enabled: true, changed: true });
  const after = await repositoryState(world, t1.plain.repositoryId);
  expect([after.enabled, after.cla_document_id]).toEqual([true, t1.documentId]);
  expect(after.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
  const audit = await enabledAuditRows(world, t1.plain.githubRepoId);
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    installation_id: t1.installationId,
    actor_github_id: people.admin1.githubId,
    subject_type: 'repository',
    metadata: { repository_id: t1.plain.repositoryId, document_id: t1.documentId },
  });
  expect(await sweeps(world)).toHaveLength(1);
});

test('the sweep is the one job of E07-S09: the reason, the numeric ids of the envelope, the coalesce key of the repository and a key that names this change', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  const stored = await repositoryState(world, t1.plain.repositoryId);
  expect(await sentJobs(world.db)).toEqual([
    {
      idempotencyKey: `sweep-repository:repository_enabled:${t1.plain.githubRepoId}:${stored.updated_at.getTime()}`,
      dedupeKey: null,
      coalesceKey: sweepRepositoryCoalesceKey(t1.plain.githubRepoId),
      job: {
        type: 'sweep-repository',
        githubInstallationId: t1.githubInstallationId,
        githubRepoId: t1.plain.githubRepoId,
        reason: 'repository_enabled',
      },
    },
  ]);
});

test('the admin of a repository turns on the repository whose own CLA is published', async () => {
  const world = await enableWorld();
  const { t1, people } = world;
  await readyScoped(world);
  const response = await enableAs(world, 'repoAdmin1', t1.scoped.repositoryId);
  expect([response.statusCode, enabledAnswerOf(response)]).toEqual([200, { enabled: true, changed: true }]);
  expect((await repositoryState(world, t1.scoped.repositoryId)).enabled).toBe(true);
  const [audit] = await enabledAuditRows(world, t1.scoped.githubRepoId);
  expect(audit).toMatchObject({
    actor_github_id: people.repoAdmin1.githubId,
    metadata: { repository_id: t1.scoped.repositoryId, document_id: t1.scoped.documentId },
  });
});

test('the org admin turns on a repository that has a repository CLA: an org admin passes both requirements', async () => {
  const world = await enableWorld();
  await readyScoped(world);
  const response = await enableAs(world, 'admin1', world.t1.scoped.repositoryId);
  expect([response.statusCode, enabledAnswerOf(response).changed]).toEqual([200, true]);
});

test('a repository that already enforces answers 200 changed false and writes no audit row and sends no job', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  const audited = (await auditRows(world, 'repository.enabled')).length;
  const stored = await repositoryState(world, t1.plain.repositoryId);
  const again = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect([again.statusCode, enabledAnswerOf(again)]).toEqual([200, { enabled: true, changed: false }]);
  expect(await auditRows(world, 'repository.enabled')).toHaveLength(audited);
  expect(await jobCount(world.db)).toBe(1);
  expect((await repositoryState(world, t1.plain.repositoryId)).updated_at).toEqual(stored.updated_at);
});

test('an enable after a disable is a new change: the flag moves again and, once the first sweep is over, a second is sent under a new key', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  await setJobStates(world.db, 'completed');
  await setEnabled(world, t1.plain.repositoryId, false);
  const again = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect(enabledAnswerOf(again).changed).toBe(true);
  const keys = (await sweeps(world)).map((sent) => sent.idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(new Set(keys).size).toBe(2);
  expect(await enabledAuditRows(world, t1.plain.githubRepoId)).toHaveLength(2);
});

test('the call makes no change besides the flag: the document, the signatures and the other repositories stay as they were', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  const before = await tablesOf(world);
  await enableAs(world, 'admin1', t1.plain.repositoryId);
  const after = await tablesOf(world);
  const was = new Map(Object.entries(before));
  const changed = Object.entries(after).filter(([table, now]) => now.checksum !== was.get(table)?.checksum);
  expect(changed.map(([table]) => table).toSorted((a, b) => a.localeCompare(b))).toEqual(['audit_log', 'repositories']);
  expect(after['repositories']?.rows).toBe(before['repositories']?.rows);
});

test.each([
  ['no body at all', undefined],
  ['an empty object', {}],
])('a call with %s is accepted', async (_label, payload) => {
  const world = await enableWorld();
  const session = await world.login(world.people.admin1.githubId);
  const response = await world.app.inject({
    method: 'POST',
    url: enablePath(world.t1.plain.repositoryId),
    headers: session.headers,
    ...(payload === undefined ? {} : { payload }),
  });
  expect([response.statusCode, enabledAnswerOf(response).changed]).toEqual([200, true]);
});

test.each([
  ['a key nobody defined', { installationId: 1 }],
  ['a document id', { documentId: 7 }],
  ['a flag', { enabled: false }],
])('a body with %s is a 400 and changes nothing', async (_label, body) => {
  const world = await enableWorld();
  const before = await tablesOf(world);
  const response = await enableAs(world, 'admin1', world.t1.plain.repositoryId, body);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  expect(await tablesOf(world)).toEqual(before);
  expect(await jobCount(world.db)).toBe(0);
});

test('a person with no session gets 401 and an id that is not an id gets 400, before anything is read', async () => {
  const world = await enableWorld();
  const anonymous = await enableAs(world, null, world.t1.plain.repositoryId);
  const garbage = await enableAs(world, 'admin1', '0x10');
  expect([anonymous.statusCode, garbage.statusCode]).toEqual([401, 400]);
  expect(parsed(garbage, errorResponseSchema).error.code).toBe('bad_request');
});

test('a repository that is removed or does not exist is the 404 of an unknown id', async () => {
  const world = await enableWorld();
  const { t1 } = world;
  const unknown = await enableAs(world, 'admin1', 987_654);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const removed = await enableAs(world, 'admin1', t1.plain.repositoryId);
  expect([unknown.statusCode, removed.statusCode]).toEqual([404, 404]);
  expect(await jobCount(world.db)).toBe(0);
});
