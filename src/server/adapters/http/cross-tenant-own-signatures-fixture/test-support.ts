// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { OWN_SIGNATURES_PATH, ownSignaturesPageSchema } from '../../../../shared/own-signatures.ts';
import { seedSignatures } from '../../../services/export/export-fixture/test-support.ts';
import type { IsolationCase } from '../cross-tenant-fixture/test-support.ts';

// The isolation case of the list of a person's own signatures (E13-S06) for the route matrix (E11-S06). It sits in a file of its own
// so that the fixture of the matrix stays under the size cap, as the entries of the registry do (`tenant-sign-fixture`).

/**
 * The list of a person's own signatures (E13-S06) names the signatures of the person of the session in every tenant, on purpose.
 * The route takes no parameter that names a person or a tenant (a query parameter is a `400`, shown in own-signatures-query.test.ts),
 * so there is nothing of another tenant to inject and the request is the same with or without it. The matrix makes each of the two
 * signers of the world sign in the other tenant as well, so the answer to each holds a row of both tenants, and the check is that
 * every row it names is the viewer's own: the other signer's row, in either tenant, is never shown.
 */
export const OWN_SIGNATURES_CASE: IsolationCase = {
  arrange: async (db, tenants) => {
    // One tenant after the other: the seeding switches a trigger off for its statement and on again.
    for (const tenant of tenants) {
      const guests = tenants
        .filter((other) => other !== tenant)
        .map((other, index) => ({ githubId: other.signer.githubId, signedAtMs: (index + 1) * 1000 }));
      await seedSignatures(db, tenant, guests);
    }
  },
  request: () => ({ method: 'GET', url: OWN_SIGNATURES_PATH }),
  rows: (body) =>
    ownSignaturesPageSchema.parse(body).items.map((item) => ({ table: 'signatures' as const, id: item.id })),
  mayShow: (owner, viewer) => owner.userId === viewer.userId,
};
