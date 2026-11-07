// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { ApprovalKind } from '../../shared/corporate-approvals.ts';
import { parseGithubId } from '../../shared/github-id.ts';
import type { StoredSubject } from './corporate-approval-subject.ts';

// An approval of a corporate agreement as the services read it (E21-S03): the row with the login snapshot of its subject, and how the
// columns a statement answers become that row.

/** One approval as it is stored, with the login snapshot of its subject (`null` for a domain, and once the person was erased). */
export interface ApprovalRow {
  readonly id: number;
  readonly agreementId: number;
  readonly kind: ApprovalKind;
  readonly source: 'manager' | 'rule';
  /** The account or organisation with its login snapshot (`null` once the person was erased), or the domain in the stored form. */
  readonly subject: StoredSubject;
  readonly derivedFromApprovalId: number | null;
  readonly approvedAt: Date;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly revokeReason: string | null;
  /** True when `expiresAt` is behind the clock of the database. */
  readonly expired: boolean;
}

/** The row as the statement answers it: the subject is still four columns, and the numeric id is not branded yet. */
interface RawApprovalRow extends Omit<ApprovalRow, 'subject'> {
  readonly githubId: number | null;
  readonly domain: string | null;
  readonly login: string | null;
}

/** The row as the services read it. The checks of the table make the subject columns agree with the kind, so a column the kind needs is there. */
export function readRow({ githubId, domain, login, ...row }: RawApprovalRow): ApprovalRow {
  return {
    ...row,
    subject:
      row.kind === 'email_domain'
        ? { kind: 'email_domain', domain: z.string().parse(domain) }
        : { kind: row.kind, githubId: parseGithubId(githubId), login },
  };
}
