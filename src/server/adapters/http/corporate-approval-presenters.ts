// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Approval, ApprovalPage, ApprovalRevoked } from '../../../shared/corporate-approvals.ts';
import type { ApprovalPageOf } from '../../services/corporate-approval-list.ts';
import type { RevokedApproval } from '../../services/corporate-approval-revoke.ts';
import type { ApprovalRow } from '../../services/corporate-approval-row.ts';
import { domainOf, githubIdOf } from '../../services/corporate-approval-subject.ts';
import { encodeCursor } from './cursor.ts';

// The answers of the approval routes of E21-S03 as they are sent: the stored rows with their instants as ISO 8601 and the opaque cursor
// that stands for the approval the next page starts at (the same `[id]` cursor the lists of E21-S02 use). No answer holds an address;
// the login of an account or organisation is the snapshot, `null` once the person was erased.

/** Where an approval is in its life: revoked once it was, else expired once its time has passed, else in force. */
function stateOf(row: ApprovalRow): Approval['state'] {
  if (row.revokedAt !== null) {
    return 'revoked';
  }
  return row.expired ? 'expired' : 'active';
}

/** One approval as the manager sees it. */
export function presentApproval(row: ApprovalRow): Approval {
  const { subject } = row;
  return {
    id: row.id,
    kind: row.kind,
    source: row.source,
    state: stateOf(row),
    githubId: githubIdOf(subject),
    domain: domainOf(subject),
    login: subject.kind === 'email_domain' ? null : subject.login,
    derivedFromApprovalId: row.derivedFromApprovalId,
    approvedAt: row.approvedAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    revokeReason: row.revokeReason,
  };
}

/** A page of the approvals of an agreement. */
export function presentApprovals(page: ApprovalPageOf): ApprovalPage {
  return {
    items: page.items.map(presentApproval),
    nextCursor: page.next === null ? null : encodeCursor([page.next.id]),
  };
}

/** The answer of a revocation. */
export function presentRevoked(revoked: RevokedApproval): ApprovalRevoked {
  return { approval: presentApproval(revoked.approval), derivedRevoked: revoked.derivedRevoked };
}
