// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { appendAudit } from '../audit.ts';
import { findInstallationByGithubId } from '../installation-queries.ts';
import type { JobHandler } from '../job-registry.ts';

// The dead-letter handler of `sync-installation` (E07-S05): the sync of an installation was tried six times and failed. The
// reconciliation of E05-S08 retries it later, so the handler only leaves a trace the operator can find: one audit row
// under the installation, with its numeric GitHub id as the subject and no personal data.

/**
 * `sync-installation`: appends `installation.sync_failed` for the installation the job names. An installation this
 * instance never stored has no tenant to attach the row to, so the job ends `logged` (the line the wrapper writes at
 * error is all there is).
 */
export function deadSyncInstallation(db: Kysely<Database>): JobHandler<'sync-installation'> {
  return async (job) => {
    const installation = await findInstallationByGithubId(db, job.githubInstallationId);
    if (installation === null) {
      return { outcome: 'logged' };
    }
    await db.transaction().execute((trx) =>
      appendAudit(trx, {
        action: 'installation.sync_failed',
        installationId: installation.id,
        actorGithubId: null,
        subject: { type: 'installation', id: job.githubInstallationId },
        metadata: { reason_code: 'retries_exhausted' },
      }),
    );
    return { outcome: 'audited' };
  };
}
