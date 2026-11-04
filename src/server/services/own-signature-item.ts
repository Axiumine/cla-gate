// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { resignPath } from '../domain/resign-path.ts';
import { type SignatureState, signatureState } from '../domain/signature-state.ts';
import type { OwnSignatureRow } from './own-signatures-queries.ts';

// One signature of a person as the list of their own signatures shows it (E13-S06): the stored row turned into the item. The state
// comes from the one function every list uses (`signatureState`) and the way to sign again from `resignPath`. Nothing of the personal
// data is read here: an item holds no name, address or login, and no reason or person of a revocation.

/** One signature of the person, as the list shows it. */
export interface OwnSignature {
  readonly id: number;
  /** The org (or account) whose CLA it is, with whether the App is suspended there. */
  readonly installation: {
    readonly accountLogin: string;
    readonly accountType: OwnSignatureRow['accountType'];
    readonly suspended: boolean;
  };
  readonly document: { readonly id: number; readonly name: string };
  readonly version: { readonly id: number; readonly major: number; readonly minor: number };
  readonly signedAt: Date;
  /** The repository the person signed from, and the pull request when there was one; `null` for a signature with no repository. */
  readonly source: { readonly repositoryFullName: string; readonly prNumber: number | null } | null;
  readonly state: SignatureState;
  readonly revokedAt: Date | null;
  readonly resignPath: string | null;
}

/** The signature of a row. The repository of the source counts only while GitHub still lists it for its installation. */
export function toOwnSignature(row: OwnSignatureRow): OwnSignature {
  const state = signatureState({ revoked: row.revokedAt !== null, major: row.major }, row.activeMajor);
  return {
    id: row.id,
    installation: {
      accountLogin: row.accountLogin,
      accountType: row.accountType,
      suspended: row.suspendedAt !== null,
    },
    document: { id: row.documentId, name: row.documentName },
    version: { id: row.versionId, major: row.major, minor: row.minor },
    signedAt: row.signedAt,
    source: row.sourceFullName === null ? null : { repositoryFullName: row.sourceFullName, prNumber: row.prNumber },
    state,
    revokedAt: row.revokedAt,
    resignPath: resignPath(state, {
      source: row.sourceRemovedAt === null ? row.sourceGithubRepoId : null,
      document: row.documentGithubRepoId,
    }),
  };
}
