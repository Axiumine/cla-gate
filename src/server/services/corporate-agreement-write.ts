// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import { CURRENT_CONSENT_ID } from '../../shared/consent.ts';
import type { CorporateAgreementRequest } from '../../shared/corporate.ts';
import type { Database } from '../adapters/db/schema.ts';
import { appendAudit } from './audit.ts';
import { insertAgreement, insertAgreementText, insertSignatoryApproval } from './corporate-agreement-queries.ts';
import type { CorporateTarget } from './corporate-target.ts';
import { NO_NETWORK_METADATA } from './network-metadata.ts';
import { insertCorporateSignature, insertSignerPii } from './sign-record-queries.ts';
import type { SignViewer } from './sign-target.ts';
import type { SignerIdentity } from './signer-input.ts';

// The transaction of corporate signing (E21-S02): the consent of the signatory (an ordinary `signatures` row of the type `corporate`),
// its personal data, the agreement, the erasable text of the company, the approval that covers the signatory personally and the
// audit row, written together in the transaction of the caller. Nothing is written before the checks of `corporate-sign.ts` have
// passed, and a failure here leaves nothing behind: no signature without its agreement, its personal data and its audit row.

/** A corporate signing request and the person of the session who makes it. */
export interface CorporateSigning {
  readonly request: CorporateAgreementRequest;
  readonly viewer: SignViewer;
}

/** The agreement that was written: it, its signature, the version it was signed under and when. */
export interface SignedAgreement {
  readonly id: number;
  readonly signatureId: number;
  readonly versionId: number;
  readonly major: number;
  readonly signedAt: Date;
}

/** What the transaction needs: the facts the checks found out and what they accepted. */
export interface Recording {
  readonly signing: CorporateSigning;
  readonly target: CorporateTarget;
  readonly identity: SignerIdentity;
  readonly companyName: string;
  readonly signatoryTitle: string;
}

/** The audit row of a new agreement, in the transaction that wrote it: ids and the major only, never a name, a title, an address or a login. */
function auditAgreement(trx: Transaction<Database>, recording: Recording, written: SignedAgreement): Promise<void> {
  const { signing, target } = recording;
  return appendAudit(trx, {
    action: 'corporate_agreement.signed',
    installationId: target.scope.installationId,
    actorGithubId: signing.viewer.githubId,
    subject: { type: 'corporate_agreement', id: written.id },
    metadata: {
      document_id: target.document.id,
      version_id: written.versionId,
      signature_id: written.signatureId,
      major: written.major,
      source_repository_id: target.repository.repositoryId,
    },
  });
}

/** The five inserts and the audit row of one agreement, in the caller's transaction. */
export async function writeAgreement(trx: Transaction<Database>, recording: Recording): Promise<SignedAgreement> {
  const { signing, target, identity } = recording;
  const { scope, document } = target;
  const { viewer } = signing;
  const signature = await insertCorporateSignature(trx, scope, {
    userId: viewer.userId,
    documentId: document.id,
    versionId: document.version.id,
    consentTextId: CURRENT_CONSENT_ID.corporate,
    sourceRepositoryId: target.repository.repositoryId,
    sourcePrNumber: null,
  });
  await insertSignerPii(trx, scope, {
    signatureId: signature.id,
    userId: viewer.userId,
    name: identity.name,
    email: identity.email,
    login: viewer.login,
    network: NO_NETWORK_METADATA,
  });
  const agreementId = await insertAgreement(trx, scope, signature.id);
  const written: SignedAgreement = {
    id: agreementId,
    signatureId: signature.id,
    versionId: document.version.id,
    major: document.version.major,
    signedAt: signature.signedAt,
  };
  await insertAgreementText(trx, scope, {
    agreementId,
    companyName: recording.companyName,
    signatoryTitle: recording.signatoryTitle,
  });
  await insertSignatoryApproval(trx, scope, {
    agreementId,
    userId: viewer.userId,
    githubId: viewer.githubId,
    login: viewer.login,
  });
  await auditAgreement(trx, recording, written);
  return written;
}
