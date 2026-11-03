// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';

// What the export of a person's own data reads besides the signatures (E16-S06; the signatures are in own-signatures-query.ts).
// The person is a data subject and belongs to no tenant, so these statements name the person and no installation: they return
// the person's rows in every tenant on purpose. Each one filters on the numeric GitHub id of the person and on nothing the
// caller supplies, so there is no way to name another person. Nothing here writes.

/** The allowlist entries that name the person (`github_id`), newest first, with the account of the installation they belong to. */
export function ownAllowlistEntries(db: Kysely<Database>, githubId: GithubId) {
  return db
    .selectFrom('allowlist_entries as e')
    .innerJoin('installations as i', 'i.id', 'e.installation_id')
    .select(['i.account_login', 'e.repository_id', 'e.kind', 'e.created_at'])
    .where('e.github_id', '=', githubId)
    .orderBy('e.created_at', 'desc')
    .orderBy('e.id', 'desc')
    .execute();
}

/**
 * The newest `limit` audit rows in which the person is the actor, or the subject of a `user` row (`subject_type = 'user'`
 * with their GitHub id), newest first. The installation is GitHub's id of it, `null` for an action of the whole instance.
 * The metadata and the other party of a row are not selected, and neither is a subject that is another person: when the
 * person is the actor of an action on someone else (an org admin who erased a signer), `subject_type` and `subject_id`
 * come back `null`, so the id of that other person never leaves the database.
 */
export function ownAuditEntries(db: Kysely<Database>, githubId: GithubId, limit: number) {
  return db
    .selectFrom('audit_log as a')
    .leftJoin('installations as i', 'i.id', 'a.installation_id')
    .select((eb) => {
      const anotherPerson = eb.and([eb('a.subject_type', '=', 'user'), eb('a.subject_id', '<>', githubId)]);
      return [
        'a.occurred_at',
        'a.action',
        'i.github_installation_id',
        eb.case().when(anotherPerson).then(null).else(eb.ref('a.subject_type')).end().as('subject_type'),
        eb.case().when(anotherPerson).then(null).else(eb.ref('a.subject_id')).end().as('subject_id'),
      ];
    })
    .where((eb) =>
      eb.or([
        eb('a.actor_github_id', '=', githubId),
        eb.and([eb('a.subject_type', '=', 'user'), eb('a.subject_id', '=', githubId)]),
      ]),
    )
    .orderBy('a.occurred_at', 'desc')
    .orderBy('a.id', 'desc')
    .limit(limit)
    .execute();
}
