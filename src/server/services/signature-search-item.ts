// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import { type SignatureState, signatureState } from '../domain/signature-state.ts';
import type { SearchRow } from './signature-search-queries.ts';

// One signature as the search shows it to a maintainer (E15-S02): the stored row turned into the item. The state comes from the one
// function every list uses (`signatureState`). The strings the signer wrote are kept exactly as they are stored: escaping them is
// the job of whatever shows them.

/** The personal data held for a signature, as the signer gave it. */
interface Signer {
  readonly login: string;
  readonly name: string;
  readonly email: string;
}

/** One signature found by the search. */
export interface FoundSignature {
  readonly id: number;
  /** The identity key of the signer: always present, whether or not the personal data is. */
  readonly githubUserId: GithubId;
  readonly document: { readonly id: number; readonly name: string };
  readonly version: { readonly major: number; readonly minor: number };
  readonly signedAt: Date;
  /** The repository the person signed from, and the pull request when there was one; `null` for a signature with no repository. */
  readonly source: { readonly repositoryFullName: string; readonly prNumber: number | null } | null;
  readonly state: SignatureState;
  readonly revokedAt: Date | null;
  readonly revokedByGithubId: GithubId | null;
  readonly revokeReasonCode: SearchRow['revokeReason'];
  /** What the person gave when signing, or `null` once it was erased. */
  readonly signer: Signer | null;
  readonly piiErased: boolean;
}

/** The three columns of the personal data, which the left join leaves null together for a signature whose data was erased. */
const signerColumns = z.object({ piiLogin: z.string(), piiName: z.string(), piiEmail: z.string() });

/** The personal data of a row, or `null` when the row has none. */
function signerOf(row: SearchRow): Signer | null {
  if (row.piiLogin === null) {
    return null;
  }
  const { piiLogin, piiName, piiEmail } = signerColumns.parse(row);
  return { login: piiLogin, name: piiName, email: piiEmail };
}

/** The signature of a row. */
export function toFoundSignature(row: SearchRow): FoundSignature {
  const signer = signerOf(row);
  return {
    id: row.id,
    githubUserId: parseGithubId(row.githubUserId),
    document: { id: row.documentId, name: row.documentName },
    version: { major: row.major, minor: row.minor },
    signedAt: row.signedAt,
    source: row.sourceFullName === null ? null : { repositoryFullName: row.sourceFullName, prNumber: row.prNumber },
    state: signatureState({ revoked: row.revokedAt !== null, major: row.major }, row.activeMajor),
    revokedAt: row.revokedAt,
    revokedByGithubId: row.revokedByGithubId === null ? null : parseGithubId(row.revokedByGithubId),
    revokeReasonCode: row.revokeReason,
    signer,
    piiErased: signer === null,
  };
}
