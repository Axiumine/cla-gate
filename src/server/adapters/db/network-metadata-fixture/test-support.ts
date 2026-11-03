// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import type { Database } from '../schema.ts';

// The network metadata of a signing as the purge of E16-S05 sees it. The two columns are created by E13-S05, which is a
// migration of its own, so the tests add them the way that migration does (`add column if not exists`) and read and write
// them with SQL text: `schema.ts` does not describe them until then.

/** The instant the purge tests treat as "now" (a fixed clock); the cutoff is 30 days before it. */
export const NOW = new Date('2026-11-03T03:17:00.000Z');

/** The cutoff of {@link NOW} with the default retention of 30 days: the instant a row stored at is still kept. */
export const CUTOFF = '2026-10-04T03:17:00.000Z';

/** The values of the two columns of one `signer_pii` row. */
export interface NetworkValues {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Adds `signer_pii.ip_address` and `signer_pii.user_agent` as E13-S05 defines them. */
export async function addNetworkColumns(db: Kysely<Database>): Promise<void> {
  await sql`alter table signer_pii add column if not exists ip_address inet, add column if not exists user_agent text`.execute(
    db,
  );
}

/** Gives the `signer_pii` row of a signature the time it was created and the values of the two columns. */
export async function setNetwork(
  db: Kysely<Database>,
  signatureId: number,
  createdAt: string,
  values: NetworkValues,
): Promise<void> {
  await sql`
    update signer_pii
       set created_at = ${createdAt}::timestamptz, ip_address = ${values.ip}::inet, user_agent = ${values.userAgent}
     where signature_id = ${signatureId}`.execute(db);
}

/** The two columns of every row, by signature id. */
export async function networkOf(db: Kysely<Database>): Promise<Record<number, NetworkValues>> {
  const { rows } = await sql<{ signature_id: number; ip: string | null; user_agent: string | null }>`
    select signature_id, host(ip_address) as ip, user_agent from signer_pii order by signature_id`.execute(db);
  return Object.fromEntries(rows.map((row) => [row.signature_id, { ip: row.ip, userAgent: row.user_agent }]));
}

/** The audit rows `network_metadata.purged`, oldest first, as the table stores them. */
export async function purgeAuditRows(db: Kysely<Database>) {
  return db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'subject_type', 'subject_id', 'metadata'])
    .where('action', '=', 'network_metadata.purged')
    .orderBy('id')
    .execute();
}

/** `n` milliseconds before or after an ISO instant. */
export function shifted(iso: string, milliseconds: number): string {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}
