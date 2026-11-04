// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { readVerifiedEmails } from '../adapters/db/sessions-read.ts';
import { judgeSignRequest, type SignRefusal } from '../domain/sign-request.ts';
import type { SignDocument } from './sign-context-queries.ts';
import { resolveSignTarget, type SignTarget } from './sign-target.ts';
import { type SignAttempt, type SignedOutcome, writeSignature } from './sign-write.ts';
import { checkSignerInput } from './signer-input.ts';

// The write path of the sign page (E13-S04): a signature, its personal data and its audit row, in one transaction. The repository
// is found the way the sign page finds it (`resolveSignTarget`), the request is held against the version in force (`judgeSignRequest`),
// then the name and the address the person typed are checked (`checkSignerInput`). Nothing is written before every check has passed,
// and a failure in the transaction leaves nothing behind: no signature without its personal data and its audit row.
//
// The reads before the transaction can be overtaken by a publication that commits before the insert. That is harmless: the signature
// names the version and the hash the person was shown, so it records exactly what they consented to. If the publication started a
// new major version, the person is simply not covered by it, and the sign page offers the new text.

/**
 * What came of an attempt: `signed` with the signature (`created` is `false` when a signature that is not revoked existed already
 * and nothing was written), the same `not_found` and `no_active_cla` as the sign page context, or the rule the request broke.
 */
export type SignOutcome =
  | SignedOutcome
  | { readonly kind: 'refused'; readonly refusal: SignRefusal }
  | Exclude<SignTarget, { readonly kind: 'found' }>;

/** The facts about the document that `judgeSignRequest` holds the request against. */
function inForce(document: SignDocument) {
  const { version } = document;
  return {
    versionId: version.id,
    major: version.major,
    minor: version.minor,
    contentSha256: version.contentSha256,
    documentKind: document.kind,
  };
}

/**
 * Records the signature the attempt asks for. In order: the repository and its tenant (`not_found`, the same for every tenant that
 * is not served), a CLA in force (`no_active_cla`), the version, hash, consent sentence and document kind (`refused`), then the
 * name and the address. The consent is stored with the exact version, its hash and the id of the sentence shown. A repeat for a
 * document and major the person signed already changes nothing and answers with the signature that exists.
 * @throws SignRuleError `invalid_name`, `no_verified_email` or `email_not_verified`; the error holds neither the name nor the address.
 */
export async function recordSignature(db: Kysely<Database>, attempt: SignAttempt): Promise<SignOutcome> {
  const { request, viewer } = attempt;
  const target = await resolveSignTarget(db, request.githubRepoId);
  if (target.kind !== 'found') {
    return target;
  }
  const refusal = judgeSignRequest(request, inForce(target.document));
  if (refusal !== null) {
    return { kind: 'refused', refusal };
  }
  const verified = await readVerifiedEmails(db, viewer.sessionRowId);
  const identity = checkSignerInput({ name: request.name, email: request.email }, verified);
  return db.transaction().execute((trx) => writeSignature(trx, { attempt, target, identity }));
}
