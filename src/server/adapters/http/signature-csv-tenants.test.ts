// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_LOG_PATH, auditLogPageSchema } from '../../../shared/audit-log.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { parseCsv } from '../../domain/csv-fixture/test-support.ts';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import { csvWorld } from './signature-csv-fixture/test-support.ts';

// The signature CSV and the tenants (E16-S03): what a tenant's file holds, the audit row the export leaves, and the budget of
// six requests a minute for each person.

/** The `signature_id` of every data row of an answer. */
const signatureIds = (body: string): number[] =>
  parseCsv(body)
    .slice(1)
    .map((cells) => Number(cells[0]));

/** The ids of the signatures a tenant holds, from the database. */
async function storedIds(db: Parameters<typeof tenantChecksums>[0], installationId: number): Promise<number[]> {
  const rows = await db
    .selectFrom('signatures')
    .select('id')
    .where('installation_id', '=', installationId)
    .orderBy('id')
    .execute();
  return rows.map((row) => row.id);
}

test('the export of tenant 1 never holds a row of tenant 2, one by the same GitHub user included, and the reverse', async () => {
  const { db, get, t1, t2 } = await csvWorld();
  const sharedPerson = t1.signer.githubId;
  await seedSignatures(db, t1, [{ githubId: 91 }]);
  await seedSignatures(db, t2, [{ githubId: sharedPerson }, { githubId: 92 }]);
  const first = await get('admin1', t1.installationId, t1.documentId);
  const second = await get('admin2', t2.installationId, t2.documentId);
  expect(signatureIds(first.body)).toEqual(await storedIds(db, t1.installationId));
  expect(signatureIds(second.body)).toEqual(await storedIds(db, t2.installationId));
  const peopleOf = (body: string) =>
    parseCsv(body)
      .slice(1)
      .map((cells) => cells[1]);
  expect(peopleOf(first.body)).toEqual([String(sharedPerson), '91']);
  expect(peopleOf(second.body)).toEqual([String(t2.signer.githubId), String(sharedPerson), '92']);
  expect(first.body).not.toContain('org-2');
  expect(second.body).not.toContain('org-1');
});

test('the audit row of the export is in the audit log of its tenant and in no other: document, state, count and the person who exported', async () => {
  const { ask, db, get, t1, t2 } = await csvWorld();
  await seedSignatures(db, t1, [{ githubId: 95, revoked: { afterMs: 1, byGithubId: 96, reason: 'other' } }]);
  expect((await get('admin1', t1.installationId, t1.documentId, '?state=revoked')).statusCode).toBe(200);
  const log = async (who: 'admin1' | 'admin2', installationId: number) =>
    auditLogPageSchema.parse(
      (
        await ask(who, {
          method: 'GET',
          url: `${AUDIT_LOG_PATH.replace(':installationId', String(installationId))}?action=signatures.exported`,
        })
      ).json(),
    ).items;
  expect(await log('admin1', t1.installationId)).toEqual([
    expect.objectContaining({
      action: 'signatures.exported',
      actor: { githubId: 31_001, login: 'login-31001' },
      subject: { type: 'document', id: t1.documentId },
      metadata: { state: 'revoked', row_count: 1 },
    }),
  ]);
  expect(await log('admin2', t2.installationId)).toEqual([]);
});

test('a call that is refused or invalid appends no audit row and changes no row of any tenant table', async () => {
  const { get, db, t1, t2 } = await csvWorld();
  const before = await tenantChecksums(db);
  const answers = [
    await get(null, t1.installationId, t1.documentId),
    await get('admin2', t1.installationId, t1.documentId),
    await get('member1', t1.installationId, t1.documentId),
    await get('admin1', t1.installationId, t2.documentId),
    await get('repoAdmin1', t1.installationId, t1.documentId),
    await get('admin1', t1.installationId, t1.documentId, '?state=nonsense'),
  ];
  expect(answers.map((answer) => answer.statusCode)).toEqual([401, 404, 404, 404, 403, 400]);
  expect(await tenantChecksums(db)).toEqual(before);
});

test('the sixth request of a minute is answered and the seventh is a 429 that appends nothing, for that person alone', async () => {
  const { db, get, scopedTarget, t1 } = await csvWorld();
  await scopedTarget();
  const statuses: number[] = [];
  for (let request = 0; request < 7; request += 1) {
    statuses.push((await get('admin1', t1.installationId, t1.documentId)).statusCode);
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200, 429]);
  const refused = await get('admin1', t1.installationId, t1.documentId);
  expect(errorResponseSchema.parse(refused.json()).error.code).toBe('too_many_requests');
  expect(refused.headers['content-type']).toContain('application/json');
  expect((await get('repoAdmin1', t1.installationId, t1.scoped.documentId)).statusCode).toBe(200);
  const audited = await db.selectFrom('audit_log').select('id').where('action', '=', 'signatures.exported').execute();
  expect(audited).toHaveLength(7);
});

test('a request the guard refuses does not use up the budget of the person who made it', async () => {
  const { get, t1, t2 } = await csvWorld();
  for (let request = 0; request < 8; request += 1) {
    expect((await get('admin1', t1.installationId, t2.documentId)).statusCode).toBe(404);
  }
  const statuses: number[] = [];
  for (let request = 0; request < 6; request += 1) {
    statuses.push((await get('admin1', t1.installationId, t1.documentId)).statusCode);
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  expect((await get('admin1', t1.installationId, t1.documentId)).statusCode).toBe(429);
});
