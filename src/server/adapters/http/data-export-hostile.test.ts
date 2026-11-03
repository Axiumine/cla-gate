// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { dataExportSchema } from '../../../shared/data-export.ts';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { ADA, adaWorld, REVOKER } from './data-export-fixture/test-support.ts';

// Hostile names in the export of a person's own data (E16-S06). JSON has no formula and no markup to inject into, so the
// export must hand every name back exactly as the signer wrote it: a string that `JSON.parse` returns byte for byte.

test('every entry of HOSTILE_NAMES comes back byte for byte in personalData.name, and as the escaped text JSON.stringify makes', async () => {
  const { db, getAda, t1 } = await adaWorld();
  await seedSignatures(
    db,
    t1,
    HOSTILE_NAMES.map((name, index) => ({
      githubId: ADA,
      pii: { login: `hostile-${index}`, name, email: `hostile${index}@example.test` },
      signedAtMs: index * 1000,
      revoked: { afterMs: 500, byGithubId: REVOKER, reason: 'signer_request' as const },
    })),
  );
  const response = await getAda();
  expect(response.statusCode).toBe(200);
  const names = dataExportSchema.parse(response.json()).signatures.map((signature) => signature.personalData?.name);
  expect(names).toEqual(HOSTILE_NAMES.toReversed());
  for (const name of HOSTILE_NAMES) {
    expect(response.body).toContain(JSON.stringify(name));
  }
});

test('an email that starts with a trigger character, and a name with a comma, a quote and a line break, are unchanged', async () => {
  const { db, getAda, t1 } = await adaWorld();
  const pii = [
    { login: 'plus', name: 'Plus', email: '+plus@example.test' },
    { login: 'minus', name: 'Minus', email: '-minus@example.test' },
    { login: 'multi', name: 'Smith, "Ada"\nLovelace', email: 'multi@example.test' },
  ];
  await seedSignatures(
    db,
    t1,
    pii.map((one, index) => ({
      githubId: ADA,
      pii: one,
      signedAtMs: index * 1000,
      revoked: { afterMs: 500, byGithubId: REVOKER, reason: 'signer_request' as const },
    })),
  );
  const found = dataExportSchema.parse((await getAda()).json()).signatures.map((signature) => signature.personalData);
  expect(found.toReversed()).toEqual(pii.map((one) => ({ ...one, ipAddress: null, userAgent: null })));
});
