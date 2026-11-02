// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { admissionWorld, auditRows, githubInstallation, OWNER, START } from './admission-fixture/test-support.ts';

const DECIDED_AT = new Date(START);
const id = parseGithubId;

const warnings = (lines: Record<string, unknown>[]) => lines.filter((line) => line['level'] === 40);

test('a rejected installation is stored as rejected with the reason, the snapshot and the time of the decision', async () => {
  const { admissionFor, store } = await admissionWorld();
  const outcome = await admissionFor([]).admit(githubInstallation(11, 5000, { login: 'stranger-org' }));
  expect(outcome).toMatchObject({ admitted: false, changed: true });
  expect(await store.findInstallationByGithubId(id(11))).toMatchObject({
    github_installation_id: 11,
    account_id: 5000,
    account_login: 'stranger-org',
    account_type: 'Organization',
    admission_status: 'rejected',
    admission_reason: 'account_not_allowed',
    admission_decided_at: DECIDED_AT,
    deleted_at: null,
  });
});

test('a rejection appends one installation.rejected audit row for the system, with numeric ids and a code only', async () => {
  const { admissionFor, db } = await admissionWorld();
  const { installation } = await admissionFor([]).admit(githubInstallation(11, 5000, { login: 'stranger-org' }));
  expect(await auditRows(db)).toEqual([
    {
      installation_id: installation.id,
      actor_github_id: null,
      action: 'installation.rejected',
      subject_type: 'installation',
      subject_id: 11,
      metadata: { account_id: 5000, account_type: 'organization', reason_code: 'account_not_allowed' },
    },
  ]);
});

test('a rejection writes one WARN line with the same ids, and neither the login nor anything personal', async () => {
  const { admissionFor, logs } = await admissionWorld();
  await admissionFor([]).admit(githubInstallation(11, 5000, { login: 'stranger-org' }));
  const lines = warnings(logs.lines());
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({
    msg: 'installation.rejected',
    githubInstallationId: 11,
    accountId: 5000,
    accountType: 'organization',
    reasonCode: 'account_not_allowed',
  });
  expect(logs.text()).not.toContain('stranger-org');
});

test('a rejected installation gets no repository rows and no audit row for one', async () => {
  const { admissionFor, db } = await admissionWorld();
  await admissionFor([]).admit(githubInstallation(11, 5000));
  expect(await db.selectFrom('repositories').select('id').execute()).toEqual([]);
  expect((await auditRows(db)).map((row) => row.action)).toEqual(['installation.rejected']);
});

test('a user account is recorded with the type user', async () => {
  const { admissionFor, db, logs } = await admissionWorld();
  await admissionFor([]).admit(githubInstallation(12, 5001, { type: 'User' }));
  expect((await auditRows(db))[0]?.metadata).toEqual({
    account_id: 5001,
    account_type: 'user',
    reason_code: 'account_not_allowed',
  });
  expect(warnings(logs.lines())[0]).toMatchObject({ accountType: 'user' });
});

test.each([
  ['the App owner', [], OWNER],
  ['an account in the list', [5000], 5000],
  ['one of several accounts in the list', [7, 5000, 8], 5000],
])(
  '%s is admitted: stored as admitted, one installation.admitted audit row, no WARN',
  async (_label, listed, account) => {
    const { admissionFor, db, logs } = await admissionWorld();
    const outcome = await admissionFor(listed).admit(githubInstallation(11, account));
    expect(outcome).toMatchObject({ admitted: true, changed: true });
    expect(outcome.installation).toMatchObject({
      admission_status: 'admitted',
      admission_reason: null,
      admission_decided_at: DECIDED_AT,
    });
    expect(await auditRows(db)).toEqual([
      {
        installation_id: outcome.installation.id,
        actor_github_id: null,
        action: 'installation.admitted',
        subject_type: 'installation',
        subject_id: 11,
        metadata: { account_id: account, account_type: 'organization' },
      },
    ]);
    expect(warnings(logs.lines())).toEqual([]);
  },
);

test('the same decision again writes no row, no audit entry and no log line', async () => {
  const { admissionFor, db, logs, clock } = await admissionWorld();
  const first = await admissionFor([]).admit(githubInstallation(11, 5000));
  clock.advance(60_000);
  const second = await admissionFor([]).admit(githubInstallation(11, 5000, { login: 'renamed' }));
  expect(second).toEqual({ admitted: false, changed: false, installation: first.installation });
  expect(second.installation.admission_decided_at).toEqual(DECIDED_AT);
  expect(await auditRows(db)).toHaveLength(1);
  expect(warnings(logs.lines())).toHaveLength(1);
});

test('an admitted account that the policy no longer lists is rejected with the reason policy_changed', async () => {
  const { admissionFor, db, logs, clock } = await admissionWorld();
  await admissionFor([5000]).admit(githubInstallation(11, 5000));
  clock.advance(3_600_000);
  const outcome = await admissionFor([]).admit(githubInstallation(11, 5000));
  expect(outcome).toMatchObject({ admitted: false, changed: true });
  expect(outcome.installation).toMatchObject({
    admission_status: 'rejected',
    admission_reason: 'policy_changed',
    admission_decided_at: new Date('2026-11-02T11:00:00.000Z'),
  });
  const rows = await auditRows(db);
  expect(rows.map((row) => [row.action, row.metadata['reason_code']])).toEqual([
    ['installation.admitted', undefined],
    ['installation.rejected', 'policy_changed'],
  ]);
  expect(warnings(logs.lines())[0]).toMatchObject({ reasonCode: 'policy_changed' });
});

test('a rejected account that the policy now lists is admitted, the reason is cleared and the time moves', async () => {
  const { admissionFor, db, clock } = await admissionWorld();
  await admissionFor([]).admit(githubInstallation(11, 5000));
  clock.advance(3_600_000);
  const outcome = await admissionFor([5000]).admit(githubInstallation(11, 5000));
  expect(outcome).toMatchObject({ admitted: true, changed: true });
  expect(outcome.installation).toMatchObject({
    admission_status: 'admitted',
    admission_reason: null,
    admission_decided_at: new Date('2026-11-02T11:00:00.000Z'),
  });
  expect((await auditRows(db)).map((row) => row.action)).toEqual(['installation.rejected', 'installation.admitted']);
});

test('a row stored without a decision (the default is rejected) gets its first decision recorded and audited', async () => {
  const { admissionFor, db, store } = await admissionWorld();
  await store.upsertInstallation({
    githubInstallationId: id(11),
    accountId: id(5000),
    accountLogin: 'acme',
    accountType: 'Organization',
    suspendedAt: null,
  });
  const outcome = await admissionFor([]).admit(githubInstallation(11, 5000));
  expect(outcome).toMatchObject({ admitted: false, changed: true });
  expect(outcome.installation).toMatchObject({
    admission_reason: 'account_not_allowed',
    admission_decided_at: DECIDED_AT,
  });
  expect((await auditRows(db)).map((row) => row.action)).toEqual(['installation.rejected']);
  expect(await db.selectFrom('installations').select('id').execute()).toHaveLength(1);
});

test('a suspended installation is stored with its suspension next to the decision', async () => {
  const { admissionFor } = await admissionWorld();
  const suspendedAt = new Date('2026-10-01T00:00:00Z');
  const { installation } = await admissionFor([5000]).admit(githubInstallation(11, 5000, { suspendedAt }));
  expect(installation).toMatchObject({ admission_status: 'admitted', suspended_at: suspendedAt });
});

test('a policy that cannot be built fails the call closed: the error reaches the caller and nothing is written', async () => {
  const { admissionWith, db } = await admissionWorld();
  const admission = admissionWith({ current: () => Promise.reject(new Error('owner unknown')) });
  await expect(admission.admit(githubInstallation(11, OWNER))).rejects.toThrow('owner unknown');
  expect(await db.selectFrom('installations').select('id').execute()).toEqual([]);
  expect(await auditRows(db)).toEqual([]);
});
