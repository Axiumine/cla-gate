// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { CORPORATE_AGREEMENTS_CSV_PATH, CORPORATE_APPROVALS_CSV_PATH } from '../../../shared/corporate-export.ts';
import { fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { approve } from '../db/corporate-fixture/test-support.ts';
import { corporateWorld, signAs, signedOf, signerWith } from './corporate-fixture/test-support.ts';

// The record the two corporate files leave (E21): who downloaded which file of which tenant and how many rows it held, as the export of the
// signatures does. The row says nothing from the file. The files themselves are in corporate-export-routes.test.ts.

const SECOND_SIGNER = 4321;

/** Ada signs for tenant 1 and approves two people and a domain; Eve signs for tenant 2 and approves one person. */
async function world() {
  const state = await corporateWorld({}, { enqueuer: fakeEnqueuer() });
  const eve = await signerWith(state, SECOND_SIGNER);
  const ada = await signAs(state, state.ada, state.c1, { companyName: 'Zzzz Audit Ltd' });
  const eves = await signAs(state, eve, state.c2, { companyName: 'Eve Ltd' });
  const adas = signedOf(state.c1, state.ada, ada);
  await approve(state.db, adas, { kind: 'user', githubId: 7001, login: 'employee-one' });
  await approve(state.db, adas, { kind: 'user', githubId: 7003, login: 'employee-three' });
  await approve(state.db, adas, { kind: 'email_domain', domain: 'acme.example' });
  await approve(state.db, signedOf(state.c2, eve, eves), { kind: 'user', githubId: 7002, login: 'employee-two' });
  return state;
}

/** The audit rows of the two exports, oldest first, as the table stores them. */
async function exportRows(db: Awaited<ReturnType<typeof world>>['db']) {
  return db
    .selectFrom('audit_log')
    .select(['action', 'installation_id', 'actor_github_id', 'subject_type', 'subject_id', 'metadata'])
    .where('action', 'in', ['corporate_agreements.exported', 'corporate_approvals.exported'])
    .orderBy('id')
    .execute();
}

test('each file leaves one audit row with the tenant, the person and the number of rows the file holds, and nothing else', async () => {
  const state = await world();
  const agreements = await state.ask('admin1', {
    method: 'GET',
    url: CORPORATE_AGREEMENTS_CSV_PATH.replace(':installationId', String(state.t1.installationId)),
  });
  const approvals = await state.ask('admin1', {
    method: 'GET',
    url: CORPORATE_APPROVALS_CSV_PATH.replace(':installationId', String(state.t1.installationId)),
  });
  expect([agreements.statusCode, approvals.statusCode]).toEqual([200, 200]);
  expect(await exportRows(state.db)).toEqual([
    {
      action: 'corporate_agreements.exported',
      installation_id: state.t1.installationId,
      actor_github_id: state.people.admin1.githubId,
      subject_type: null,
      subject_id: null,
      metadata: { row_count: 1 },
    },
    {
      action: 'corporate_approvals.exported',
      installation_id: state.t1.installationId,
      actor_github_id: state.people.admin1.githubId,
      subject_type: null,
      subject_id: null,
      metadata: { row_count: 4 },
    },
  ]);
  expect(agreements.body).toContain('Zzzz Audit Ltd');
});

test('the other tenant counts its own rows and is recorded as its own, and a second download is a second row', async () => {
  const state = await world();
  const url = CORPORATE_APPROVALS_CSV_PATH.replace(':installationId', String(state.t2.installationId));
  await state.ask('admin2', { method: 'GET', url });
  await state.ask('admin2', { method: 'GET', url });
  expect((await exportRows(state.db)).map((row) => [row.installation_id, row.actor_github_id, row.metadata])).toEqual([
    [state.t2.installationId, state.people.admin2.githubId, { row_count: 2 }],
    [state.t2.installationId, state.people.admin2.githubId, { row_count: 2 }],
  ]);
});

test('the row holds no login, company or domain, whatever the file holds', async () => {
  const state = await world();
  await state.ask('admin1', {
    method: 'GET',
    url: CORPORATE_AGREEMENTS_CSV_PATH.replace(':installationId', String(state.t1.installationId)),
  });
  const stored = JSON.stringify(await exportRows(state.db));
  for (const word of ['Zzzz Audit', 'employee-one', 'acme.example']) {
    expect(stored, word).not.toContain(word);
  }
});
