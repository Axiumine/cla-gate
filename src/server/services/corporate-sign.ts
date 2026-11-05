// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { readVerifiedEmails } from '../adapters/db/sessions-read.ts';
import { isUniqueViolation } from '../adapters/db/violations.ts';
import { judgeCorporateRequest, readAgreementTexts } from '../domain/corporate-sign-request.ts';
import { type CorporateSigning, type SignedAgreement, writeAgreement } from './corporate-agreement-write.ts';
import { CorporateRuleError } from './corporate-rule-error.ts';
import { resolveCorporateTarget } from './corporate-target.ts';
import { checkSignerInput } from './signer-input.ts';

// The write path of corporate signing (E21-S02): the checks, then the transaction (`writeAgreement`). The repository is found the way
// the corporate sign page finds it (`resolveCorporateTarget`), the request is held against the version in force
// (`judgeCorporateRequest`), then the texts and the name the person typed are checked. Nothing is written before every check has
// passed. The signatory becomes the CLA manager of the agreement because they are the person of its signature; no other table or role
// says so.

/**
 * The address the signatory is reached at: their primary verified address, else the first one GitHub reported. The request names no
 * address, so the server chooses one of the addresses the session captured at login; an empty list is no address at all.
 */
function addressOf(verified: readonly { readonly email: string; readonly primary: boolean }[]): string {
  return (verified.find(({ primary }) => primary) ?? verified[0])?.email ?? '';
}

/**
 * Records the corporate agreement the request asks for. In order: the repository and its tenant (`not_found`, the same for every
 * tenant that is not served; `installation_suspended`; `corporate_cla_not_configured`), the version and the hash (`version_outdated`,
 * `hash_mismatch`), then the confirmation of the authority and the texts (`validation_failed`), then the typed name and the address of
 * the signatory. The consent is stored with the exact version, its hash and the id of the corporate sentence. A second agreement of
 * the same person for the corporate document and major is the unique violation of `signatures_active_unique`, mapped to
 * `agreement_exists`; the answer names no id of the agreement that exists.
 * @throws CorporateRuleError the rules above. SignRuleError `invalid_name`, `no_verified_email` or `email_not_verified`; the error holds
 * neither the name nor the address.
 */
export async function recordCorporateAgreement(
  db: Kysely<Database>,
  signing: CorporateSigning,
): Promise<SignedAgreement> {
  const { request, viewer } = signing;
  const target = await resolveCorporateTarget(db, request.githubRepoId, 'write');
  const { version } = target.document;
  const refusal = judgeCorporateRequest(request, {
    versionId: version.id,
    major: version.major,
    minor: version.minor,
    contentSha256: version.contentSha256,
  });
  if (refusal !== null) {
    throw refusal.rule === 'version_outdated'
      ? new CorporateRuleError(refusal.rule, { current: { ...refusal.current } })
      : new CorporateRuleError(refusal.rule);
  }
  const texts = readAgreementTexts(request);
  if (!texts.ok) {
    throw new CorporateRuleError('validation_failed', { field: texts.field });
  }
  const verified = await readVerifiedEmails(db, viewer.sessionRowId);
  const identity = checkSignerInput({ name: request.typedName, email: addressOf(verified) }, verified);
  try {
    return await db.transaction().execute((trx) =>
      writeAgreement(trx, {
        signing,
        target,
        identity,
        companyName: texts.companyName,
        signatoryTitle: texts.signatoryTitle,
      }),
    );
  } catch (error) {
    throw isUniqueViolation(error, 'signatures_active_unique') ? new CorporateRuleError('agreement_exists') : error;
  }
}
