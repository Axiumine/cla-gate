// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parseGithubId } from '../../../../shared/github-id.ts';
import { insertAllowlistEntry } from '../../../services/allowlist-entry-queries.ts';
import { sendAllowlistSweeps } from '../../../services/allowlist-sweeps.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import { ownersOfGithubIds } from '../tenant-owners/test-support.ts';
import type { Refusal, ScopedQuery } from '../tenant-registry/test-support.ts';

// The entries of the registry of the tenant data access (E11-S06) for adding an allowlist entry (E14-S06), kept in a file of their own so
// that the registry stays under the size cap. `TENANT_QUERIES` spreads them in under `services/allowlist-entry-queries.ts` and
// `services/allowlist-sweeps.ts`. The world has an allowlist entry of the installation and one of the repository for each tenant.

/** The `Error` of a database that refused a row for a foreign key (`23503`): a repository that is another installation's. */
const isForeignKeyViolation: Refusal = (error) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === '23503';

/** The GitHub id of the account the entries of the fixture exempt: no entry of the world has it. */
const ACCOUNT = parseGithubId(777);

/** A job as the queue port takes it. */
type SentJob = Parameters<JobEnqueuer['enqueue']>[1];

/** An enqueuer that keeps the jobs it is asked to send and writes nothing. */
function recordingEnqueuer(sent: SentJob[]): JobEnqueuer {
  return {
    enqueue: (_tx, job) => {
      sent.push(job);
      return Promise.resolve('queued');
    },
  };
}

export const ALLOWLIST_TENANT_QUERIES: Readonly<Record<string, Readonly<Record<string, ScopedQuery>>>> = {
  'services/allowlist-entry-queries.ts': {
    // The row names the installation of the scope in its own column, so a repository of another tenant is turned away by the
    // composite foreign key of migration 001 and nothing is stored.
    insertAllowlistEntry: {
      kind: 'scoped',
      takesIds: true,
      activeOnly: false,
      refusal: isForeignKeyViolation,
      run: async (db, scope, ids) => {
        const stored = await db.transaction().execute((trx) =>
          insertAllowlistEntry(trx, scope, {
            repositoryId: ids.plain.repositoryId,
            kind: 'user',
            githubId: ACCOUNT,
            loginSnapshot: 'zzzz-account',
            createdBy: ids.admin.userId,
          }),
        );
        // The world stores no entry of this account, so the entry is new; a duplicate would be none of the tenant's rows here.
        const entryIds = [stored].filter((row) => row !== undefined).map((row) => row.id);
        const rows = await db
          .selectFrom('allowlist_entries')
          .select('installation_id')
          .where('id', 'in', entryIds)
          .execute();
        return rows.map((row) => row.installation_id);
      },
    },
  },
  'services/allowlist-sweeps.ts': {
    // A repository of another tenant is not in the WHERE clause's installation, so it is not swept; the plain repository of each
    // tenant is turned on first, so that the sweep of the tenant's own has something to send.
    sendAllowlistSweeps: {
      kind: 'scoped',
      takesIds: true,
      activeOnly: true,
      arrange: async (db, tenants) => {
        await db
          .updateTable('repositories')
          .set({ enabled: true })
          .where(
            'id',
            'in',
            tenants.map((tenant) => tenant.plain.repositoryId),
          )
          .execute();
      },
      run: async (db, scope, ids) => {
        const sent: SentJob[] = [];
        await db.transaction().execute((trx) =>
          sendAllowlistSweeps(trx, scope, recordingEnqueuer(sent), {
            repositoryId: ids.plain.repositoryId,
            change: 'created:1',
          }),
        );
        return ownersOfGithubIds(
          db,
          sent.filter((job) => job.type === 'sweep-repository').map((job) => job.githubRepoId),
        );
      },
    },
  },
};
