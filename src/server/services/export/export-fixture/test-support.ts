// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import { HOSTILE_NAMES } from '../../../../shared/hostile-names.ts';
import type { Database } from '../../../adapters/db/schema.ts';
import type { TenantScope } from '../../../adapters/db/tenant-scope.ts';
import { publishVersion, sha256 } from '../../../adapters/db/test-support.ts';
import { ACTOR } from '../../test-support.ts';
import { openSignatureExport } from '../signature-export.ts';
import type { SignatureFilter } from '../signature-filter.ts';

// Signatures with the instants the test chooses (E16-S03). The database refuses a `signed_at` that is not within five minutes
// of its own clock, so that evidence cannot be back-dated; the export tests need fixed instants (a boundary at the
// millisecond, a file stored as a snapshot), so the seeding switches that one trigger off for the statement and on again.

/** The first instant of the seeded signatures: each seed is a number of milliseconds after it. */
const SEED_EPOCH = Date.parse('2026-10-15T09:00:00.000Z');

/** The instant `offsetMs` milliseconds after {@link SEED_EPOCH}. */
export const seedInstant = (offsetMs: number): Date => new Date(SEED_EPOCH + offsetMs);

/** The reasons a revocation may carry: the database check on `signatures.revoke_reason`. */
type RevokeReason = 'signer_request' | 'maintainer_decision' | 'legal_request' | 'other';

/** A published version a signature can name: its id, its major and the hash of its text, which the foreign key ties together. */
export interface VersionRef {
  readonly id: number;
  readonly major: number;
  readonly sha256: string;
}

/** One signature to store; everything but the signer has a default. */
export interface SignatureSeed {
  /** The signer. The `users` row is created when there is none; its login is `login-<id>`. */
  readonly githubId: number;
  /** The personal data held for the signature; `null` stores none, as after an erasure. Defaults to name, email and login made from the id. */
  readonly pii?: { readonly login: string; readonly name: string; readonly email: string } | null;
  /** When it was signed: milliseconds after {@link SEED_EPOCH}. Defaults to the position in the list, in seconds. */
  readonly signedAtMs?: number;
  /** The version signed, as {@link activateMajor} returns it. Defaults to the version 1.0 of the tenant. */
  readonly version?: VersionRef;
  /** The signature was revoked this many milliseconds after it was signed, by this person, for this reason. */
  readonly revoked?: { readonly afterMs: number; readonly byGithubId: number; readonly reason: RevokeReason };
  /** `repositories.id` the person signed from, or `null`. Defaults to the repository of the tenant. */
  readonly repositoryId?: number | null;
  /** The pull request they signed for. Defaults to 7 when there is a repository. */
  readonly prNumber?: number | null;
}

/** What a tenant has to give for the seeding: its installation, its document, the version 1.0 and the repository. */
interface SeedTarget {
  readonly installationId: number;
  readonly documentId: number;
  readonly versionId: number;
  readonly contentSha256: string;
  readonly repositoryId: number;
}

const rowId = z.int().positive();

/** The ids the seeded users got, by GitHub id, creating the ones that do not exist. */
async function usersOf(db: Kysely<Database>, githubIds: readonly number[]): Promise<Map<number, number>> {
  const unique = [...new Set(githubIds)];
  await db
    .insertInto('users')
    .values(unique.map((id) => ({ github_id: id, login: `login-${id}`, name: `Name ${id}`, avatar_url: null })))
    .onConflict((conflict) => conflict.column('github_id').doNothing())
    .execute();
  const rows = await db.selectFrom('users').select(['id', 'github_id']).where('github_id', 'in', unique).execute();
  return new Map(rows.map((row) => [row.github_id, row.id]));
}

/** The personal data of a seed: what it says, none for `null`, or the default made from the signer's id. */
function piiOf(seed: SignatureSeed) {
  if (seed.pii === null) {
    return null;
  }
  return (
    seed.pii ?? {
      login: `login-${seed.githubId}`,
      name: `Name ${seed.githubId}`,
      email: `u${seed.githubId}@example.test`,
    }
  );
}

/** What a seed is stored against: the tenant, the version it names unless it chooses another, and the row of a GitHub id. */
interface RowContext {
  readonly target: SeedTarget;
  readonly first: VersionRef;
  readonly userId: (githubId: number) => number;
}

/** The `signatures` row of one seed. */
function signatureRow(seed: SignatureSeed, index: number, context: RowContext) {
  const { target, first, userId } = context;
  const signedAt = seedInstant(seed.signedAtMs ?? index * 1000);
  const version = seed.version ?? first;
  const repositoryId = seed.repositoryId === undefined ? target.repositoryId : seed.repositoryId;
  return {
    installation_id: target.installationId,
    user_id: userId(seed.githubId),
    document_id: target.documentId,
    version_id: version.id,
    major: version.major,
    content_sha256: version.sha256,
    consent_text_id: 'consent-v1',
    signer_type: 'individual' as const,
    signed_at: signedAt,
    source_repository_id: repositoryId,
    source_pr_number: repositoryId === null ? null : (seed.prNumber ?? 7),
    revoked_at: seed.revoked === undefined ? null : new Date(signedAt.getTime() + seed.revoked.afterMs),
    revoked_by: seed.revoked === undefined ? null : userId(seed.revoked.byGithubId),
    revoke_reason: seed.revoked?.reason ?? null,
  };
}

/**
 * Stores the signatures in one statement each for the signatures and their personal data, in the order given, and returns
 * their ids in that order. A revoked seed is stored revoked.
 */
export async function seedSignatures(
  db: Kysely<Database>,
  target: SeedTarget,
  seeds: readonly SignatureSeed[],
): Promise<number[]> {
  if (seeds.length === 0) {
    return [];
  }
  const people = await usersOf(db, [
    ...seeds.map((seed) => seed.githubId),
    ...seeds.flatMap((seed) => (seed.revoked === undefined ? [] : [seed.revoked.byGithubId])),
  ]);
  const userId = (githubId: number): number => rowId.parse(people.get(githubId));
  const first: VersionRef = { id: target.versionId, major: 1, sha256: target.contentSha256 };
  await sql`alter table signatures disable trigger signatures_current_timestamp`.execute(db);
  try {
    const inserted = await db
      .insertInto('signatures')
      .values(seeds.map((seed, index) => signatureRow(seed, index, { target, first, userId })))
      .returning('id')
      .execute();
    const ids = inserted.map((row) => row.id);
    const held = seeds.flatMap((seed, index) => {
      const pii = piiOf(seed);
      return pii === null ? [] : [{ signature_id: rowId.parse(ids.at(index)), user_id: userId(seed.githubId), ...pii }];
    });
    if (held.length > 0) {
      await db.insertInto('signer_pii').values(held).execute();
    }
    return ids;
  } finally {
    await sql`alter table signatures enable trigger signatures_current_timestamp`.execute(db);
  }
}

/** Publishes version `major`.0 of the document and makes it the active one. */
export async function activateMajor(
  db: Kysely<Database>,
  target: Pick<SeedTarget, 'documentId'> & { readonly publisherId: number },
  major: number,
): Promise<VersionRef> {
  const text = `CLA text of major ${major}`;
  const version = await publishVersion(db, target.documentId, target.publisherId, { major, minor: 0, text });
  await db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', target.documentId)
    .execute();
  return { id: version.id, major, sha256: sha256(text) };
}

/** Reads the stream to its end and returns the bytes. */
export function readBytes(stream: Readable): Promise<Buffer> {
  return buffer(stream);
}

/** What an export produced: the file as text, the rows the audit row counted, and the errors the end of the snapshot reported. */
export interface ExportRun {
  readonly text: string;
  readonly bytes: Buffer;
  readonly rowCount: number;
  readonly releaseErrors: readonly unknown[];
}

/** Opens the export of `filter` for the tenant as the test actor and reads it to the end. */
export async function runExport(db: Kysely<Database>, scope: TenantScope, filter: SignatureFilter): Promise<ExportRun> {
  const releaseErrors: unknown[] = [];
  const opened = await openSignatureExport(db, scope, filter, {
    actor: ACTOR,
    onReleaseError: releaseErrors.push.bind(releaseErrors),
  });
  const bytes = await readBytes(opened.stream);
  return { text: bytes.toString('utf8'), bytes, rowCount: opened.rowCount, releaseErrors };
}

/** The name of the document in the hostile dataset: a formula, a comma and double quotes. */
export const HOSTILE_DOCUMENT_NAME = '=1+1 "Individual CLA", v1';

/** An address whose local part starts with a plus sign, and one that starts with a minus sign. */
const HOSTILE_EMAILS = ['+plus@example.test', '-minus@example.test'];

/**
 * The seeded dataset of the hostile-name tests: one signature per entry of `HOSTILE_NAMES`, two with an address that starts
 * with a trigger, one whose name holds a comma, a double quote and a line break, one whose personal data was erased and one
 * revoked. Their ids and instants are fixed, so the file they make can be stored as a snapshot.
 */
export const HOSTILE_SEEDS: readonly SignatureSeed[] = [
  ...HOSTILE_NAMES.map((name, index) => ({
    githubId: 5000 + index,
    pii: { login: `hostile-${index}`, name, email: `hostile${index}@example.test` },
  })),
  ...HOSTILE_EMAILS.map((email, index) => ({
    githubId: 6000 + index,
    pii: { login: `address-${index}`, name: `Address ${index}`, email },
  })),
  { githubId: 7000, pii: { login: 'multi-line', name: 'Smith, "Ada"\nLovelace', email: 'multi@example.test' } },
  { githubId: 7001, pii: null },
  { githubId: 7002, revoked: { afterMs: 86_400_000, byGithubId: 7003, reason: 'legal_request' } },
];
