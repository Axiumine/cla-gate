// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../adapters/db/schema.ts';
import type { TenantWorld } from '../../../adapters/db/tenant-fixture/test-support.ts';
import { seedInstant } from '../export-fixture/test-support.ts';

// The rows around a person that the export of their own data reads and the seed of a tenant leaves out (E16-S06): allowlist
// entries that name them and audit rows with the instants a test chooses.

/** An allowlist entry to store; the tenant's publisher made it. */
export interface AllowlistSeed {
  readonly tenant: TenantWorld;
  /** The numeric GitHub id the entry names. */
  readonly githubId: number;
  readonly kind?: 'user' | 'bot' | 'org_members';
  /** The repository the entry applies to, or `null` (the default) for the whole installation. */
  readonly repositoryId?: number | null;
  /** Milliseconds after the first seeded instant. */
  readonly createdAtMs: number;
}

/** Stores the allowlist entries; they belong to their tenant and name a person by the numeric GitHub id. */
export async function seedAllowlist(db: Kysely<Database>, seeds: readonly AllowlistSeed[]): Promise<void> {
  await db
    .insertInto('allowlist_entries')
    .values(
      seeds.map((seed) => ({
        installation_id: seed.tenant.installationId,
        repository_id: seed.repositoryId ?? null,
        kind: seed.kind ?? 'user',
        github_id: seed.githubId,
        created_by: seed.tenant.publisherId,
        created_at: seedInstant(seed.createdAtMs),
      })),
    )
    .execute();
}

/** An audit row to store, with the instant it happened at. */
export interface AuditSeed {
  readonly action: string;
  /** `installations.id`, or `null` for an action of the whole instance. */
  readonly installationId: number | null;
  readonly actorGithubId: number | null;
  readonly subject?: { readonly type: string; readonly id: number };
  /** Milliseconds after the first seeded instant. */
  readonly atMs: number;
}

/** Stores the audit rows as they are given, which the writer of the product would not allow: the test chooses the instants. */
export async function seedAudit(db: Kysely<Database>, seeds: readonly AuditSeed[]): Promise<void> {
  await db
    .insertInto('audit_log')
    .values(
      seeds.map((seed) => ({
        occurred_at: seedInstant(seed.atMs),
        installation_id: seed.installationId,
        actor_github_id: seed.actorGithubId,
        action: seed.action,
        subject_type: seed.subject?.type ?? null,
        subject_id: seed.subject?.id ?? null,
        metadata: '{}',
      })),
    )
    .execute();
}
