// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../../shared/github-id.ts';
import { ownAllowlistEntries, ownAuditEntries } from '../../../services/export/own-data-queries.ts';
import { ownSignatures } from '../../../services/export/own-signatures-query.ts';
import { countSignatures, signatureBatch } from '../../../services/export/signature-queries.ts';
import { ownersOfSignatures } from '../tenant-owners/test-support.ts';
import type { ScopedQuery, TenantQuery } from '../tenant-registry/test-support.ts';

// The registry entries (E11-S06) of the statements the exports run over a tenant table: the signatures of one document (the
// CSV of E16-S03) and a person's own data (E16-S06). They sit in a file of their own so that the registry stays under the
// size cap, as the entries of the job queue do (`tenant-jobs-fixture`).

/** A function that takes the tenant and the ids of a resource and answers with the rows of that tenant it read. */
const scoped = (options: Pick<ScopedQuery, 'run'>): ScopedQuery => ({
  kind: 'scoped',
  takesIds: true,
  activeOnly: false,
  ...options,
});

/** Every function that the export modules export over a tenant table, by module and name. */
export const EXPORT_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, TenantQuery>>>> = {
  // The export of a person's own data (E16-S06) reads the person's rows in every tenant, on purpose: a data subject belongs to no
  // tenant. Each statement names the person's own key and nothing else, so called for the signer of tenant 1 it finds tenant
  // 1's rows and for the signer of tenant 2 tenant 2's. The seed gives each tenant one signature by its own signer, an allowlist
  // entry that names `n * 100` (installation `n * 5000`) and an audit row whose actor is `n * 1000 + 1`.
  'services/export/own-data-queries.ts': {
    ownAllowlistEntries: {
      kind: 'by_design',
      reason:
        "the export of a person's own data lists the allowlist entries that name the person in every tenant (E16-S06); the statement filters on the numeric GitHub id of the person and on nothing the caller supplies",
      pinnedBy: 'services/export/own-data-queries.test.ts',
      run: async (db, _scope, ids) =>
        (await ownAllowlistEntries(db, parseGithubId(ids.githubInstallationId / 50))).map((row) => row.account_login),
      answers: (own, other) => ({ own: [own.accountLogin], foreign: [other.accountLogin] }),
    },
    ownAuditEntries: {
      kind: 'by_design',
      reason:
        "the export of a person's own data lists the audit rows in which the person is the actor or the subject, in every tenant (E16-S06); the statement filters on the numeric GitHub id of the person and on nothing the caller supplies",
      pinnedBy: 'services/export/own-data-queries.test.ts',
      run: async (db, _scope, ids) => {
        const rows = await ownAuditEntries(db, parseGithubId(ids.githubInstallationId / 5 + 1), 10);
        return [...new Set(rows.map((row) => row.github_installation_id))];
      },
      answers: (own, other) => ({ own: [own.githubInstallationId], foreign: [other.githubInstallationId] }),
    },
  },
  'services/export/own-signatures-query.ts': {
    ownSignatures: {
      kind: 'by_design',
      reason:
        "the export of a person's own data lists the person's signatures in every tenant (E16-S06); the person is a data subject and belongs to no tenant, and the statement filters on the person's own key and on nothing the caller supplies",
      pinnedBy: 'services/export/own-data-queries.test.ts',
      run: async (db, _scope, ids) => (await ownSignatures(db, ids.signer.userId)).map((row) => row.id),
      answers: (own, other) => ({ own: [own.signatureId], foreign: [other.signatureId] }),
    },
  },
  'services/export/signature-queries.ts': {
    // The seed gives each tenant one signature on its installation-wide document, so the export of that document finds the
    // tenant's own row with its own ids and nothing with another tenant's.
    countSignatures: scoped({
      run: async (db, scope, ids) => {
        const count = await countSignatures(db, scope, { documentId: ids.documentId, state: 'all' });
        return count === 0 ? [] : ownersOfSignatures(db, [ids.signatureId]);
      },
    }),
    signatureBatch: scoped({
      run: async (db, scope, ids) => {
        const rows = await signatureBatch(
          db,
          scope,
          { documentId: ids.documentId, state: 'all' },
          { afterId: 0, limit: 10 },
        );
        return rows.length === 0
          ? []
          : ownersOfSignatures(
              db,
              rows.map((row) => row.signature_id),
            );
      },
    }),
  },
};
