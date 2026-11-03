// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { beforeEach, expect, test, vi } from 'vitest';
import { dataExportSchema } from '../../../shared/data-export.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { twoTenants } from '../../adapters/db/tenant-fixture/test-support.ts';
import { containing, migratedTestDatabase } from '../../adapters/db/test-support.ts';
import type * as Audit from '../audit.ts';
import { seedSignatures } from './export-fixture/test-support.ts';
import { exportOwnData } from './own-data.ts';
import type * as Queries from './own-data-queries.ts';
import type * as Signatures from './own-signatures-query.ts';

// The data subject export as one unit (E16-S06): the reads and the audit row `data_export.created` share one `repeatable
// read` transaction, and the row says how many signatures the document holds. The statements are in own-data-queries.test.ts
// and the route in adapters/http/data-export-*.test.ts. The statements are wrapped to note which transaction they run in; they
// still run against the migrated database.

/** What a step of the export saw of its transaction: its name, the isolation level and the transaction id. */
interface TransactionStep {
  readonly step: string;
  readonly isolation: string;
  readonly tx: string;
}

/**
 * The steps seen so far, and the wrapper that notes one: a function that takes the database handle first is called after the
 * isolation level and the id of the transaction its handle is in were noted. It is built here, with `kysely` loaded when it
 * runs, because a mock factory that loads a module of the tests would wait for a module that waits for the mock.
 */
const probe = vi.hoisted(() => {
  const steps: TransactionStep[] = [];
  const noted =
    <Args extends [Kysely<Database>, ...unknown[]], Result>(step: string, run: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      const { sql } = await import('kysely');
      const { rows } = await sql<{
        isolation: string;
        tx: string;
      }>`select current_setting('transaction_isolation') as isolation, txid_current()::text as tx`.execute(args[0]);
      steps.push(...rows.map((row) => ({ step, isolation: row.isolation, tx: row.tx })));
      return run(...args);
    };
  return { steps, noted };
});

vi.mock('./own-signatures-query.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Signatures>();
  return { ...actual, ownSignatures: probe.noted('signatures', actual.ownSignatures) };
});

vi.mock('./own-data-queries.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    ownAllowlistEntries: probe.noted('allowlist', actual.ownAllowlistEntries),
    ownAuditEntries: probe.noted('audit entries', actual.ownAuditEntries),
  };
});

vi.mock('../audit.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof Audit>();
  return { ...actual, appendAudit: probe.noted('audit row', actual.appendAudit) };
});

beforeEach(() => {
  probe.steps.length = 0;
});

const NOW = new Date('2026-11-02T10:00:00.000Z');

async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  return { db, ...tenants };
}

const auditRows = (db: Awaited<ReturnType<typeof world>>['db']) =>
  db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'subject_type', 'subject_id', 'metadata'])
    .where('action', '=', 'data_export.created')
    .execute();

test('the reads and the audit row run in one repeatable read transaction, the row last', async () => {
  const { db, t1 } = await world();
  await exportOwnData(db, t1.signer.githubId, NOW);
  expect(probe.steps.map((step) => step.step)).toEqual(['signatures', 'allowlist', 'audit entries', 'audit row']);
  expect(new Set(probe.steps.map((step) => step.isolation))).toEqual(new Set(['repeatable read']));
  expect(new Set(probe.steps.map((step) => step.tx)).size).toBe(1);
});

test('the audit row names the person as actor and subject, no installation, and the number of signatures in the document', async () => {
  const { db, t1 } = await world();
  await seedSignatures(db, t1, [
    { githubId: t1.signer.githubId, signedAtMs: 1000, revoked: { afterMs: 1, byGithubId: 1001, reason: 'other' } },
    { githubId: t1.signer.githubId, signedAtMs: 2000, revoked: { afterMs: 1, byGithubId: 1001, reason: 'other' } },
  ]);
  const document = await exportOwnData(db, t1.signer.githubId, NOW);
  expect(document.signatures).toHaveLength(3);
  expect(await auditRows(db)).toEqual([
    {
      installation_id: null,
      actor_github_id: t1.signer.githubId,
      subject_type: 'user',
      subject_id: t1.signer.githubId,
      metadata: { signature_count: 3 },
    },
  ]);
});

test('the document is the one dataExportSchema describes, dated by the instant given', async () => {
  const { db, t2 } = await world();
  const document = await exportOwnData(db, t2.signer.githubId, NOW);
  expect(dataExportSchema.parse(document)).toEqual(document);
  expect(document.exportedAt).toBe('2026-11-02T10:00:00.000Z');
  expect(document.user.githubId).toBe(t2.signer.githubId);
});

test('an audit row that cannot be written means no document and no row, and a second try succeeds once it can', async () => {
  const { db, t1 } = await world();
  await sql`
    create function refuse_export_audit() returns trigger language plpgsql as $$
    begin raise exception 'audit insert refused'; end $$`.execute(db);
  await sql`
    create trigger refuse_export_audit before insert on audit_log for each row
    when (new.action = 'data_export.created') execute function refuse_export_audit()`.execute(db);
  await expect(exportOwnData(db, t1.signer.githubId, NOW)).rejects.toMatchObject({
    message: containing('audit insert refused'),
  });
  expect(await auditRows(db)).toEqual([]);
  await sql`drop trigger refuse_export_audit on audit_log`.execute(db);
  await expect(exportOwnData(db, t1.signer.githubId, NOW)).resolves.toMatchObject({ truncated: false });
  expect(await auditRows(db)).toHaveLength(1);
});

test('a person the instance holds no user row for is not exported and leaves no audit row', async () => {
  const { db } = await world();
  await expect(exportOwnData(db, parseGithubId(987_654), NOW)).rejects.toThrow();
  expect(await auditRows(db)).toEqual([]);
  expect(probe.steps).toEqual([]);
});
