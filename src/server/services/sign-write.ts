// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { SignRequest } from '../../shared/sign.ts';
import type { Database } from '../adapters/db/schema.ts';
import { appendAudit } from './audit.ts';
import {
  findLiveSignature,
  insertSignature,
  insertSignerPii,
  type StoredSignedSignature,
} from './sign-record-queries.ts';
import type { SignTarget, SignViewer } from './sign-target.ts';
import type { SignerIdentity } from './signer-input.ts';

// The inserts of the sign request (E13-S04), in the transaction the caller opened: the signature, the personal data of its signer
// and the audit row, or none of them when the signature exists already. The checks that come before are in sign-record.ts.

/** A sign request and the person who makes it. */
export interface SignAttempt {
  readonly request: SignRequest;
  readonly viewer: SignViewer;
}

/** A signature that was recorded now (`created`) or that existed already. */
export interface SignedOutcome {
  readonly kind: 'signed';
  readonly created: boolean;
  readonly signature: StoredSignedSignature;
}

/** What the transaction needs: the facts the checks found out and the identity that passed them. */
export interface Recording {
  readonly attempt: SignAttempt;
  readonly target: Extract<SignTarget, { readonly kind: 'found' }>;
  readonly identity: SignerIdentity;
}

/** The audit row of a new signature, in the transaction that wrote it: ids only, never the name, the address or the login. */
async function auditSignature(trx: Transaction<Database>, recording: Recording, signatureId: number): Promise<void> {
  const { attempt, target } = recording;
  const { version } = target.document;
  await appendAudit(trx, {
    action: 'signature.created',
    installationId: target.scope.installationId,
    actorGithubId: attempt.viewer.githubId,
    subject: { type: 'signature', id: signatureId },
    metadata: {
      document_id: target.document.id,
      version_id: version.id,
      major: version.major,
      source_repository_id: target.repository.repositoryId,
      source_pr_number: attempt.request.prNumber ?? null,
    },
  });
}

/**
 * The inserts and the audit row of one signature, in the caller's transaction. When a signature that is not revoked exists for the
 * person, the document and the major version, nothing is written, not even the personal data, and the existing signature is the
 * answer: the stored name and address are never overwritten by a repeat.
 */
export async function writeSignature(trx: Transaction<Database>, recording: Recording): Promise<SignedOutcome> {
  const { attempt, target, identity } = recording;
  const { request, viewer } = attempt;
  const { scope, document } = target;
  const { version } = document;
  const inserted = await insertSignature(trx, scope, {
    userId: viewer.userId,
    documentId: document.id,
    versionId: version.id,
    consentTextId: request.consentTextId,
    sourceRepositoryId: target.repository.repositoryId,
    sourcePrNumber: request.prNumber ?? null,
  });
  if (inserted === null) {
    const existing = await findLiveSignature(trx, scope, {
      userId: viewer.userId,
      documentId: document.id,
      major: version.major,
    });
    return { kind: 'signed', created: false, signature: existing };
  }
  await insertSignerPii(trx, scope, {
    signatureId: inserted.id,
    userId: viewer.userId,
    name: identity.name,
    email: identity.email,
    login: viewer.login,
  });
  await auditSignature(trx, recording, inserted.id);
  return {
    kind: 'signed',
    created: true,
    signature: {
      id: inserted.id,
      versionId: version.id,
      major: version.major,
      minor: version.minor,
      signedAt: inserted.signedAt,
    },
  };
}
