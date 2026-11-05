// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../../shared/github-id.ts';
import { listInstallationsForOperator } from '../../../services/installation-operator.ts';
import { eraseInInstallation, readSignerFootprint } from '../../../services/operator-erasure-queries.ts';
import type { TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements the instance operator runs: the list of installations (E05-S07) and the
// erasure command of E22-S05. Both meet every tenant by design, because the operator is the server's and not a tenant's. They sit
// in a file of their own so that the registry stays under the size cap. The seed gives each tenant one signer, with one signature
// and one row of personal data in that tenant only.

/** Every function of the operator's statements, by module and name. */
export const OPERATOR_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  'services/installation-operator.ts': {
    listInstallationsForOperator: {
      kind: 'by_design',
      reason:
        "the operator sees every installation of the instance, with counts of its repositories and no person (E05-S07); it reads across tenants on purpose and grants no access to a tenant's data (E11-S08)",
      pinnedBy: 'services/installation-operator.test.ts',
      run: async (db) => (await listInstallationsForOperator(db)).map((row) => row.githubInstallationId),
      answers: (own, other) => {
        const both = [own.githubInstallationId, other.githubInstallationId];
        return { own: both, foreign: both };
      },
    },
  },
  'services/operator-erasure-queries.ts': {
    readSignerFootprint: {
      kind: 'by_design',
      reason:
        "an erasure request to the server is about a person, whose GitHub id is global, so the operator's command reads the installations the person signed in and the counts of their rows there, and nothing but counts and ids (E22-S05); it names no tenant to start from",
      pinnedBy: 'services/operator-erasure-queries.test.ts',
      run: async (db, _scope, ids) =>
        (await readSignerFootprint(db, ids.signer.githubId)).installations.map((row) => row.installationId),
      answers: (own, other) => ({ own: [own.installationId], foreign: [other.installationId] }),
    },
    eraseInInstallation: {
      kind: 'by_design',
      reason:
        "the operator's command calls the audited SQL function erase_signer_pii once per installation the person signed in, for the installation the footprint named (E22-S05); the function deletes the person's rows of that installation only, so a person with no rows there loses nothing",
      pinnedBy: 'services/operator-erasure-queries.test.ts',
      run: (db, scope, ids) =>
        eraseInInstallation(db, { githubId: ids.signer.githubId, actor: parseGithubId(1) }, scope.installationId),
      // The tenant's own signer has one row in it; the other tenant's signer has none there, and keeps the one it has at home.
      answers: () => ({ own: 1, foreign: 0 }),
    },
  },
};
