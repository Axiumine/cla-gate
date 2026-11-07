// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ownCorporateAgreements, ownCorporateApprovals } from '../../../services/export/own-corporate-queries.ts';
import { corporateTenant } from '../corporate-fixture/test-support.ts';
import { ownersOfAgreements, ownersOfApprovals } from '../tenant-corporate-fixture/test-support.ts';
import type { TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the two statements the export of a person's own data runs over the corporate tables (E21): the
// agreements the person signed and the approvals that name them. The seed stores no corporate row, so each run gives the tenant's
// signer an agreement with the approvals of every kind first, as the entries of `tenant-corporate-fixture` do.

/** The files of the export that run a statement over a corporate table. */
export const E21_EXPORT_TENANT_MODULES = ['services/export/own-corporate-queries.ts'] as const;

/** Every function of those files, by module and name. */
export const E21_EXPORT_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/export/own-corporate-queries.ts': {
    ownCorporateAgreements: {
      kind: 'by_design',
      reason:
        "the export of a person's own data lists the corporate agreements the person signed in every tenant (E21); the signatory is a data subject and belongs to no tenant, and the statement filters on the person's own key and on nothing the caller supplies",
      pinnedBy: 'services/export/own-corporate-queries.test.ts',
      run: async (db, _scope, ids) => {
        await corporateTenant(db, ids, ids.signer.githubId);
        const rows = await ownCorporateAgreements(db, ids.signer.userId);
        return ownersOfAgreements(
          db,
          rows.map((row) => row.id),
        );
      },
      answers: (own, other) => ({ own: [own.installationId], foreign: [other.installationId] }),
    },
    ownCorporateApprovals: {
      kind: 'by_design',
      reason:
        "the export of a person's own data lists the corporate approvals that name the person in every tenant (E21); the approved person is a data subject and belongs to no tenant, and the statement filters on the person's numeric GitHub id and on nothing the caller supplies",
      pinnedBy: 'services/export/own-corporate-queries.test.ts',
      run: async (db, _scope, ids) => {
        await corporateTenant(db, ids, ids.signer.githubId);
        const rows = await ownCorporateApprovals(db, ids.signer.githubId);
        return ownersOfApprovals(
          db,
          rows.map((row) => row.id),
        );
      },
      answers: (own, other) => ({ own: [own.installationId], foreign: [other.installationId] }),
    },
  },
};
