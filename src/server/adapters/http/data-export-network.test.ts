// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { dropNetworkColumns, setNetwork } from '../db/network-metadata-fixture/test-support.ts';
import { ADA, adaWorld, REVOKER } from './data-export-fixture/test-support.ts';

// The network values in the export of a person's own data (E16-S06): the address and the user agent of a signing have a value
// only when the operator switched recording on (E13-S05). The export shows them when they are stored and `null` otherwise, also
// for a database that does not have the columns (one from before migration 014).

const STORED = '2026-10-20T00:00:00.000Z';

/** Ada's world with two signatures in tenant 1: the first signed from an address, the second with nothing recorded. */
async function signedTwice() {
  const state = await adaWorld();
  const [recorded, plain] = await seedSignatures(state.db, state.t1, [
    { githubId: ADA, signedAtMs: 0, revoked: { afterMs: 500, byGithubId: REVOKER, reason: 'signer_request' } },
    { githubId: ADA, signedAtMs: 1000 },
  ]);
  return { ...state, recorded: recorded ?? 0, plain: plain ?? 0 };
}

test('with no network columns in the database every personalData has null for the address and the user agent', async () => {
  const { db, exportedAda } = await signedTwice();
  await dropNetworkColumns(db);
  const { signatures } = await exportedAda();
  expect(signatures.map((signature) => [signature.personalData?.ipAddress, signature.personalData?.userAgent])).toEqual(
    [
      [null, null],
      [null, null],
    ],
  );
});

test.each([
  ['an IPv4 address', '203.0.113.7', 'Browser/1.0 (X11)'],
  ['an IPv6 address', '2001:db8::2', 'Other/2.0'],
  ['an address and no user agent', '198.51.100.9', null],
  ['a user agent and no address', null, 'Agent/3.0'],
])(
  'the columns are there and %s is stored: the export shows it, and null for the signature with none',
  async (_label, ip, userAgent) => {
    const { db, exportedAda, recorded } = await signedTwice();
    await setNetwork(db, recorded, STORED, { ip, userAgent });
    const { signatures } = await exportedAda();
    expect(signatures.map((signature) => signature.personalData)).toEqual([
      expect.objectContaining({ ipAddress: null, userAgent: null }),
      expect.objectContaining({ ipAddress: ip, userAgent }),
    ]);
  },
);

test('the columns are there and nothing is stored: every value is null', async () => {
  const { exportedAda } = await signedTwice();
  const { signatures } = await exportedAda();
  expect(signatures.map((signature) => signature.personalData)).toEqual([
    expect.objectContaining({ ipAddress: null, userAgent: null }),
    expect.objectContaining({ ipAddress: null, userAgent: null }),
  ]);
});

test('a signature whose personal data was erased shows no network values either, because it shows no personal data', async () => {
  const { db, exportedAda, recorded } = await signedTwice();
  await setNetwork(db, recorded, STORED, { ip: '203.0.113.7', userAgent: 'Browser/1.0' });
  await db.deleteFrom('signer_pii').where('signature_id', '=', recorded).execute();
  const { signatures } = await exportedAda();
  expect(signatures.map((signature) => signature.personalData === null)).toEqual([false, true]);
});
