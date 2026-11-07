// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Transaction } from 'kysely';
import type { ApprovalKind } from '../../shared/corporate-approvals.ts';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import type { TenantScope } from '../adapters/db/tenant-scope.ts';
import { appendAudit } from './audit.ts';
import type { ApprovalRow } from './corporate-approval-row.ts';
import { githubIdOf } from './corporate-approval-subject.ts';

// The audit rows of the approvals of a corporate agreement (E21-S03), written in the transaction of the change they record. A row names
// the approval as its subject and carries ids and codes only: the kind, the numeric id of the account or organisation (`null` for a
// domain, which is not written at all: the approval says it) and the signature of the agreement. Never a login, an address, a domain, a
// company name or the reason of a revocation.

/**
 * Why a row was written, besides the manager's own decision: the approval was copied from an earlier major, revoked with its parent, or
 * (E21-S04) revoked because it had expired when its person claimed again.
 */
type Cause = 'carried_over' | 'parent_revoked' | 'expired';

/** The approval a row is about. */
export interface AuditedApproval {
  readonly id: number;
  readonly kind: ApprovalKind;
  readonly githubId: GithubId | null;
}

/** The part of an approval an audit row is written from. */
export function auditedOf(row: ApprovalRow): AuditedApproval {
  return { id: row.id, kind: row.kind, githubId: githubIdOf(row.subject) };
}

/** Who did it, in which tenant, under which agreement (by the id of its signature), and why when it was not the manager's plain decision. */
export interface ApprovalAuditContext {
  readonly scope: TenantScope;
  readonly actorGithubId: GithubId;
  readonly signatureId: number;
  readonly cause: Cause | null;
}

/** One audit row about an approval, in the caller's transaction. */
function appendApprovalAudit(
  trx: Transaction<Database>,
  action: 'corporate_approval.added' | 'corporate_approval.revoked' | 'corporate_approval.derived',
  context: ApprovalAuditContext,
  approval: AuditedApproval,
): Promise<void> {
  return appendAudit(trx, {
    action,
    installationId: context.scope.installationId,
    actorGithubId: context.actorGithubId,
    subject: { type: 'corporate_approval', id: approval.id },
    metadata: {
      kind: approval.kind,
      github_id: approval.githubId,
      signature_id: context.signatureId,
      reason_code: context.cause,
    },
  });
}

/** An approval of the manager was added, or copied to this agreement from an earlier major (`reason_code` `carried_over`). */
export function auditApprovalAdded(
  trx: Transaction<Database>,
  context: ApprovalAuditContext,
  approval: AuditedApproval,
): Promise<void> {
  return appendApprovalAudit(trx, 'corporate_approval.added', context, approval);
}

/** An approval was revoked, by the manager or (`reason_code` `parent_revoked`) with the domain or organisation approval it derives from. */
export function auditApprovalRevoked(
  trx: Transaction<Database>,
  context: ApprovalAuditContext,
  approval: AuditedApproval,
): Promise<void> {
  return appendApprovalAudit(trx, 'corporate_approval.revoked', context, approval);
}

/**
 * An approval was derived for an employee who claimed coverage (E21-S04): the actor is the employee, the approval is theirs and the cause is
 * none, since the rule that matched is the manager's decision and the derivation says which approval it came from through the row itself.
 */
export function auditApprovalDerived(
  trx: Transaction<Database>,
  context: ApprovalAuditContext,
  approval: AuditedApproval,
): Promise<void> {
  return appendApprovalAudit(trx, 'corporate_approval.derived', context, approval);
}
