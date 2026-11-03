// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { createJobsTable, fakeEnqueuer, jobCount, sentJobs } from '../../services/jobs-fixture/test-support.ts';
import {
  type DocumentWorld,
  documentWorld,
  errorCodeOf,
  parsed,
  publishAs,
  saveDraftAs,
  tablesOf,
  versionsPath,
} from './document-fixture/test-support.ts';
import { CLA_BODY_LIMIT } from './limits.ts';

// The queue behind the publish route and the limits of its body (E12-S04). The queue is the fake of the webhook intake, which
// writes into a test table on the transaction it is given, or the app's own, which fails every send until the pg-boss one is
// wired (E07-S01).

const wide = (world: DocumentWorld) => ({ installationId: world.t1.installationId, documentId: world.t1.documentId });
const scoped = (world: DocumentWorld) => ({
  installationId: world.t1.installationId,
  documentId: world.t1.scoped.documentId,
});

const publication = (expectedActiveVersionId: number | null) => ({
  source: { type: 'draft', revision: 1 },
  bump: 'major',
  rationale: 'Because',
  expectedActiveVersionId,
  acknowledgeResigning: true,
});

/** Makes the plain repository of tenant 1 enforce the installation-wide document: attached to it and enabled. */
async function enforceWide(world: DocumentWorld): Promise<void> {
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: world.t1.documentId, enabled: true })
    .where('id', '=', world.t1.plain.repositoryId)
    .execute();
}

test('a major version sends its sweep through the queue of the app, and the job is there once the publish is', async () => {
  const world = await documentWorld({ enqueuer: fakeEnqueuer() });
  await createJobsTable(world.db);
  await enforceWide(world);
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'New terms\n', expectedRevision: null });
  const response = await publishAs(world, 'admin1', wide(world), publication(world.t1.versionId));
  expect(response.statusCode).toBe(201);
  expect((await sentJobs(world.db)).map(({ job }) => job)).toEqual([
    {
      type: 'sweep-repository',
      githubInstallationId: world.t1.githubInstallationId,
      githubRepoId: world.t1.plain.githubRepoId,
      reason: 'cla_version_published',
    },
  ]);
});

test('a queue that fails fails the publish: 500, and no version, no audit row, the pointer and the draft as they were', async () => {
  const world = await documentWorld({ enqueuer: { enqueue: () => Promise.reject(new Error('queue down')) } });
  await enforceWide(world);
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'New terms\n', expectedRevision: null });
  const before = await tablesOf(world);
  const response = await publishAs(world, 'admin1', wide(world), publication(world.t1.versionId));
  expect(response.statusCode).toBe(500);
  expect(parsed(response, errorResponseSchema).error.code).toBe('internal_server_error');
  expect(response.body).not.toContain('queue down');
  expect(await tablesOf(world)).toEqual(before);
});

test('the queue that is sent a job after the send and then fails leaves no job behind, because it commits with the version', async () => {
  const inner = fakeEnqueuer();
  const world = await documentWorld({
    enqueuer: {
      enqueue: async (tx, job, options) => {
        await inner.enqueue(tx, job, options);
        throw new Error('connection lost');
      },
    },
  });
  await createJobsTable(world.db);
  await enforceWide(world);
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'New terms\n', expectedRevision: null });
  const response = await publishAs(world, 'admin1', wide(world), publication(world.t1.versionId));
  expect(response.statusCode).toBe(500);
  expect(await jobCount(world.db)).toBe(0);
});

test('the app that has no queue yet fails a major version that has a repository to sweep, and publishes one that has none', async () => {
  const world = await documentWorld();
  await enforceWide(world);
  await saveDraftAs(world, 'admin1', wide(world), { contentMd: 'New terms\n', expectedRevision: null });
  const refused = await publishAs(world, 'admin1', wide(world), publication(world.t1.versionId));
  expect(refused.statusCode).toBe(500);
  const none = await publishAs(world, 'admin1', scoped(world), publication(null));
  expect(none.statusCode).toBe(201);
});

test('a body of exactly 512 KiB is read and one byte more is 413 payload_too_large, with nothing stored', async () => {
  const world = await documentWorld();
  const admin = await world.login(world.people.admin1.githubId);
  const url = versionsPath(world.t1.installationId, world.t1.scoped.documentId);
  const frame = JSON.stringify({ ...publication(null), rationale: '' }).length;
  const bodyOf = (bytes: number) => JSON.stringify({ ...publication(null), rationale: 'r'.repeat(bytes - frame) });
  const before = await tablesOf(world);
  const send = (payload: string) =>
    world.app.inject({
      method: 'POST',
      url,
      headers: { ...admin.headers, 'content-type': 'application/json' },
      payload,
    });
  const atLimit = await send(bodyOf(CLA_BODY_LIMIT));
  const over = await send(bodyOf(CLA_BODY_LIMIT + 1));
  expect([atLimit.statusCode, errorCodeOf(atLimit)]).toEqual([422, 'invalid_rationale']);
  expect([over.statusCode, errorCodeOf(over)]).toEqual([413, 'payload_too_large']);
  expect(await tablesOf(world)).toEqual(before);
});

test.each([
  ['a Markdown file', 'text/markdown', '# Title\n'],
  ['plain text', 'text/plain', 'publish'],
  ['a urlencoded form', 'application/x-www-form-urlencoded', 'bump=major'],
  ['multipart form data', 'multipart/form-data; boundary=xyz', '--xyz--\r\n'],
] as const)(
  '%s is 415 unsupported_media_type: the publish reads application/json only',
  async (_label, type, payload) => {
    const world = await documentWorld();
    const admin = await world.login(world.people.admin1.githubId);
    const response = await world.app.inject({
      method: 'POST',
      url: versionsPath(world.t1.installationId, world.t1.scoped.documentId),
      headers: { ...admin.headers, 'content-type': type },
      payload,
    });
    expect([response.statusCode, errorCodeOf(response)]).toEqual([415, 'unsupported_media_type']);
  },
);
