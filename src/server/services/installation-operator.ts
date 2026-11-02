// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';

/**
 * One installation as the operator sees it (E05-S07): what the instance decided about the account and how much of it
 * is in use. Ids, flags, times and counts only; the login is the display snapshot GitHub gave for the account, and no
 * person is named (no sender, no member, no signer).
 */
export interface OperatorInstallation {
  /** The tenant key. */
  readonly githubInstallationId: GithubId;
  readonly accountId: GithubId;
  /** A display snapshot, refreshed by every sync; the id is the identity. */
  readonly accountLogin: string;
  readonly accountType: 'Organization' | 'User';
  readonly admissionStatus: 'admitted' | 'rejected';
  /** Why a rejected installation is rejected; null for an admitted one and for one nobody has decided on yet. */
  readonly admissionReason: 'account_not_allowed' | 'policy_changed' | null;
  /** When the decision last changed; null while nobody has decided. */
  readonly admissionDecidedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly deletedAt: Date | null;
  readonly repositories: {
    /** Stored and not removed. */
    readonly active: number;
    /** Active and enforced. */
    readonly enabled: number;
    /** Removed (access lost, uninstalled or transferred); the rows stay. */
    readonly removed: number;
  };
}

/** Every installation the instance knows, rejected and deleted ones included, oldest GitHub installation first. */
export async function listInstallationsForOperator(db: Kysely<Database>): Promise<OperatorInstallation[]> {
  const rows = await db
    .selectFrom('installations as i')
    .leftJoin('repositories as r', 'r.installation_id', 'i.id')
    .select([
      'i.github_installation_id',
      'i.account_id',
      'i.account_login',
      'i.account_type',
      'i.admission_status',
      'i.admission_reason',
      'i.admission_decided_at',
      'i.suspended_at',
      'i.deleted_at',
    ])
    .select([
      sql<number>`(count(r.id) filter (where r.removed_at is null))::int`.as('active'),
      sql<number>`(count(r.id) filter (where r.removed_at is null and r.enabled))::int`.as('enabled'),
      sql<number>`(count(r.id) filter (where r.removed_at is not null))::int`.as('removed'),
    ])
    .groupBy('i.id')
    .orderBy('i.github_installation_id')
    .execute();
  return rows.map((row) => ({
    githubInstallationId: parseGithubId(row.github_installation_id),
    accountId: parseGithubId(row.account_id),
    accountLogin: row.account_login,
    accountType: row.account_type,
    admissionStatus: row.admission_status,
    admissionReason: row.admission_reason,
    admissionDecidedAt: row.admission_decided_at,
    suspendedAt: row.suspended_at,
    deletedAt: row.deleted_at,
    repositories: { active: row.active, enabled: row.enabled, removed: row.removed },
  }));
}
