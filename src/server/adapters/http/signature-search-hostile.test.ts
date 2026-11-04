// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { SIGN_PATH } from '../../../shared/sign.ts';
import { createJobsTable, fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { serveTenant } from './sign-context-fixture/test-support.ts';
import { ADA_EMAIL, bodyFor } from './sign-fixture/test-support.ts';
import { pageOf, searchWorld } from './signature-search-fixture/test-support.ts';

// Hostile names in the search for signatures (E15-S02). The answer is JSON, which has no formula and no markup to inject into, and the
// strings are returned verbatim and not escaped here: whatever shows them later (the screen of E18) escapes them for its own output.

/** The first GitHub id of the signers of the test: one person for each name, so that no one meets the budget of the sign request. */
const FIRST_SIGNER = 5000;

test('every entry of HOSTILE_NAMES, signed through the real sign path, comes back byte for byte in signer.name, as raw as JSON writes it', async () => {
  const { app, db, login, search, t1 } = await searchWorld({ enqueuer: fakeEnqueuer() });
  await createJobsTable(db);
  await serveTenant(db, t1);
  for (const [index, name] of HOSTILE_NAMES.entries()) {
    const signer = await login(FIRST_SIGNER + index);
    await db
      .updateTable('sessions')
      .set({ verified_emails: JSON.stringify([ADA_EMAIL]) })
      .where('id', '=', signer.sessionId)
      .execute();
    const signed = await app.inject({
      method: 'POST',
      url: SIGN_PATH,
      headers: { ...signer.headers, 'content-type': 'application/json' },
      payload: JSON.stringify(bodyFor(t1, 1, { name })),
    });
    expect([index, signed.statusCode]).toEqual([index, 201]);
  }
  const response = await search('admin1', t1.installationId, '?limit=100&state=active');
  const signers = new Set(HOSTILE_NAMES.map((_name, index) => FIRST_SIGNER + index));
  const found = pageOf(response).items.filter((item) => signers.has(item.githubUserId));
  expect(found).toHaveLength(HOSTILE_NAMES.length);
  const byId = new Map<number, string | undefined>(found.map((item) => [item.githubUserId, item.signer?.name]));
  for (const [index, name] of HOSTILE_NAMES.entries()) {
    const returned = byId.get(FIRST_SIGNER + index);
    expect(Buffer.from(returned ?? '', 'utf8').equals(Buffer.from(name, 'utf8')), `entry ${index}`).toBe(true);
    expect(response.body, `entry ${index}`).toContain(JSON.stringify(name));
  }
});
