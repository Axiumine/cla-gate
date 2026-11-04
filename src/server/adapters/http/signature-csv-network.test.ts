// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { setNetwork } from '../db/network-metadata-fixture/test-support.ts';
import { TEST_AGENT, TEST_IP } from './sign-network-fixture/test-support.ts';
import { csvWorld } from './signature-csv-fixture/test-support.ts';

// The network metadata of a signing (E13-S05) is not in the CSV export of the signatures of a document (E16-S03): an org admin
// reads who signed what, and the address and the user agent are visible to the person in their own export only.

test('the CSV an org admin downloads holds neither the address nor the user agent that is stored with a signature', async () => {
  const { db, get, t1 } = await csvWorld();
  await setNetwork(db, t1.signatureId, '2026-10-20T00:00:00.000Z', { ip: TEST_IP, userAgent: TEST_AGENT });
  const response = await get('admin1', t1.installationId, t1.documentId);
  expect(response.statusCode).toBe(200);
  expect(response.body).toContain(`login-${t1.signer.githubId}`);
  expect(response.body).not.toContain(TEST_IP);
  expect(response.body).not.toContain(TEST_AGENT);
});
