// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignatureFact } from '../../domain/evaluation/index.ts';
import { batches } from '../repository-rows.ts';
import type { PolicyScope } from './policy-facts.ts';

// The signatures the evaluation reads (E07-S04), last of its facts. A numeric GitHub id is the only identity: a signature is
// found through `users.github_id`, never through a login or an email, and every statement filters by the installation.

/**
 * The signatures of `githubIds` on the document, not revoked, with the id of each and the version and major it was made
 * under. A person is found by their numeric GitHub id through `users`; a signature of another installation's document is
 * never returned, and a person who signed nothing is simply absent.
 */
export async function readSignatures(
  scope: PolicyScope,
  documentId: number,
  githubIds: readonly number[],
): Promise<SignatureFact[]> {
  const facts: SignatureFact[] = [];
  for (const batch of batches(githubIds)) {
    const rows = await scope.db
      .selectFrom('signatures as signature')
      .innerJoin('users as person', 'person.id', 'signature.user_id')
      .select([
        'signature.id as id',
        'person.github_id as githubId',
        'signature.document_id as documentId',
        'signature.version_id as versionId',
        'signature.major as major',
      ])
      .where('signature.installation_id', '=', scope.installationId)
      .where('signature.document_id', '=', documentId)
      .where('signature.revoked_at', 'is', null)
      .where('person.github_id', 'in', batch)
      .orderBy('signature.id')
      .execute();
    facts.push(...rows.map((row) => ({ ...row, revoked: false })));
  }
  return facts;
}
