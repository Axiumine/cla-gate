// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { DATA_EXPORT_AUDIT_LIMIT, type DataExport } from '../../../shared/data-export.ts';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { appendAudit } from '../audit.ts';
import { ownAllowlistEntries, ownAuditEntries } from './own-data-queries.ts';
import { buildDataExport } from './own-data-rows.ts';
import { ownSignatures } from './own-signatures-query.ts';

// The data subject export (E16-S06): everything the instance holds about the signed-in person, read from one snapshot, and
// the audit row that records that it was made.

/**
 * Reads the data of the person with the numeric GitHub id `githubId` across every tenant, and appends the audit row
 * `data_export.created` (the person is actor and subject, no installation, `signature_count` as metadata) in the same
 * `repeatable read` transaction, so the record and the export agree: the count in the row is the number of signatures in the
 * document, and the document is not delivered when the row cannot be written. The row that this call writes is not in the
 * document (the audit entries were read before it); the next export shows it. `now` is the instant the document carries.
 * @throws Error when the instance holds no `users` row for `githubId`, which a session guarantees against.
 */
export async function exportOwnData(db: Kysely<Database>, githubId: GithubId, now: Date): Promise<DataExport> {
  return db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (trx) => {
      const user = await trx
        .selectFrom('users')
        .select(['id', 'github_id', 'login', 'name', 'created_at'])
        .where('github_id', '=', githubId)
        .executeTakeFirstOrThrow();
      const signatures = await ownSignatures(trx, user.id);
      const allowlistEntries = await ownAllowlistEntries(trx, githubId);
      const auditEntries = await ownAuditEntries(trx, githubId, DATA_EXPORT_AUDIT_LIMIT + 1);
      await appendAudit(trx, {
        action: 'data_export.created',
        installationId: null,
        actorGithubId: githubId,
        subject: { type: 'user', id: githubId },
        metadata: { signature_count: signatures.length },
      });
      return buildDataExport({
        now,
        user: { githubId: user.github_id, login: user.login, name: user.name, createdAt: user.created_at },
        signatures,
        allowlistEntries,
        auditEntries,
      });
    });
}
