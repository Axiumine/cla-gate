// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { currentCorporateConsent } from '../../../shared/consent.ts';
import type {
  CorporateAgreement,
  CorporateAgreementCreated,
  CorporateAgreementPage,
  CorporateDocumentResponse,
  TenantAgreement,
  TenantAgreementPage,
} from '../../../shared/corporate.ts';
import type { AgreementPosition, AgreementRow } from '../../services/corporate-agreement-queries.ts';
import type { SignedAgreement } from '../../services/corporate-agreement-write.ts';
import type { AgreementPage } from '../../services/corporate-agreements.ts';
import type { CorporateTarget } from '../../services/corporate-target.ts';
import { decodeCursor, encodeCursor } from './cursor.ts';

// The corporate answers as the routes of E21-S02 send them: the stored rows with their instants as ISO 8601 and the opaque cursor that
// stands for the agreement the next page starts at. No answer holds an address; a name of a company or a title is `null` once the
// signatory was erased.

/** The cursor stands for `[id]`: the id of the newest agreement the page leaves out, a positive integer. */
const positionSchema = z.tuple([z.int().positive()]).transform(([id]): AgreementPosition => ({ id }));

/** The place a cursor stands for. @throws AppError 400 `bad_request` when the cursor is not one this server made. */
export function readAgreementCursor(cursor: string): AgreementPosition {
  return decodeCursor(positionSchema, cursor);
}

/** The opaque cursor of the next page, or `null` on the last page. */
function nextCursor(page: AgreementPage): string | null {
  return page.next === null ? null : encodeCursor([page.next.id]);
}

/** The corporate CLA in force as the sign page needs it: the stored text of the version, its hash and the consent sentence. */
export function presentCorporateDocument(target: CorporateTarget): CorporateDocumentResponse {
  const { repository, document } = target;
  const { version } = document;
  return {
    repository: { githubRepoId: repository.githubRepoId, fullName: repository.fullName },
    document: { id: document.id, name: document.name },
    versionId: version.id,
    major: version.major,
    minor: version.minor,
    contentMd: version.contentMd,
    contentSha256: version.contentSha256,
    publishedAt: version.publishedAt.toISOString(),
    consent: currentCorporateConsent(),
  };
}

/** What the `201` names: the agreement and its signature, never a name, a title or an address. */
export function presentSignedAgreement(agreement: SignedAgreement): CorporateAgreementCreated {
  return {
    agreement: {
      id: agreement.id,
      signatureId: agreement.signatureId,
      versionId: agreement.versionId,
      major: agreement.major,
      signedAt: agreement.signedAt.toISOString(),
    },
  };
}

/** One agreement as its signatory sees it. */
export function presentOwnAgreement(row: AgreementRow): CorporateAgreement {
  return {
    id: row.id,
    signatureId: row.signatureId,
    signedAt: row.signedAt.toISOString(),
    major: row.major,
    companyName: row.companyName,
    signatoryTitle: row.signatoryTitle,
    document: { id: row.documentId, name: row.documentName },
    installation: { accountLogin: row.accountLogin },
    activeApprovalCount: row.activeApprovals,
    revoked: row.revokedAt !== null,
  };
}

/** A page of the agreements of the signed-in person. */
export function presentOwnAgreements(page: AgreementPage): CorporateAgreementPage {
  return { items: page.items.map(presentOwnAgreement), nextCursor: nextCursor(page) };
}

/** One agreement as an org admin of its tenant sees it: the signatory by numeric id with the login snapshot, no title. */
function presentTenantAgreement(row: AgreementRow): TenantAgreement {
  return {
    id: row.id,
    signatureId: row.signatureId,
    signedAt: row.signedAt.toISOString(),
    major: row.major,
    companyName: row.companyName,
    signatory: { githubId: row.signatoryGithubId, login: row.signatoryLogin },
    activeApprovalCount: row.activeApprovals,
    revoked: row.revokedAt !== null,
  };
}

/** A page of the agreements of a tenant. */
export function presentTenantAgreements(page: AgreementPage): TenantAgreementPage {
  return { items: page.items.map(presentTenantAgreement), nextCursor: nextCursor(page) };
}
