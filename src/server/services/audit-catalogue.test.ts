// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { AUDIT_ACTIONS, AUDIT_METADATA_KEYS, type AuditAction } from '../../shared/audit.ts';
import { auditMetadataSchema } from '../../shared/audit-metadata.ts';
import { serverSources } from '../adapters/db/tenant-scan/test-support.ts';
import { migratedTestDatabase, seedTenant } from '../adapters/db/test-support.ts';
import { appendAudit } from './audit.ts';
import { entryOf, fixtureProblems, SITE_FIXTURES } from './audit-conformance/test-support.ts';
import { auditCallSites, catalogueProblems, usageProblems } from './audit-scan/test-support.ts';

// The catalogue of audit actions and the code that writes them (E16-S01). The writer, the closed set and the route guard
// are E04-S09; this file proves the set is complete once the mutation epics have landed, that nothing hides in it, and
// that what each call site writes passes both checks on metadata. The scan runs once per file: it builds a program.

const SERVER = path.resolve(import.meta.dirname, '..');

/**
 * The actions the mutation epics document for their audit rows. A name an epic needs but `AUDIT_ACTIONS` lacks fails the
 * first test with the name in the message; the epic adds the name in the change that adds the mutation.
 */
const REQUIRED_ACTIONS: readonly AuditAction[] = [
  'signature.created',
  'signature.revoked',
  'signatures.invalidated',
  'signatures.exported',
  'commit_override.created',
  'commit_override.deleted',
  'allowlist_entry.created',
  'allowlist_entry.deleted',
  'repository.enabled',
  'repository.disabled',
  'repository.cla_document_attached',
  'repository.cla_document_detached',
  'signer_pii.erased',
  'network_metadata.purged',
  'data_export.created',
];

/**
 * Names in `AUDIT_ACTIONS` that no `appendAudit` call in the server writes yet, each with the reason. An entry goes when its
 * call site lands: the usage test fails for a reserved name that a call site writes, so the list cannot go stale.
 */
const RESERVED_ACTIONS: Readonly<Partial<Record<AuditAction, string>>> = {
  'signature.created': 'written by the signing transaction (E13-S04)',
  'signature.revoked': 'written by the revoke endpoint (E15-S03)',
  'signatures.invalidated': 'written by the invalidation of a document major (E15-S04)',
  'commit_override.created': 'written by the commit override endpoint (E15-S05)',
  'commit_override.deleted': 'written by the override removal endpoint (E15-S06)',
  'signer_pii.erased': 'written by the SQL function erase_signer_pii, not by a call of appendAudit (E16-S04)',
  'network_metadata.purged':
    'written by the SQL function purge_signer_network_metadata, not by a call of appendAudit (E16-S05)',
};

const sites = auditCallSites(SERVER, serverSources(SERVER));
const written = new Set(sites.flatMap((site) => site.actions));

test('AUDIT_ACTIONS has every action the mutation epics need and lists none twice', () => {
  expect(catalogueProblems(AUDIT_ACTIONS, REQUIRED_ACTIONS)).toEqual([]);
});

test('the scan finds the call sites of the server and every one of them can be read statically', () => {
  expect(sites.length).toBeGreaterThanOrEqual(6);
  expect(sites.flatMap((site) => site.problems.map((problem) => `${site.file}:${site.line} ${problem}`))).toEqual([]);
  expect(sites.every((site) => site.actions.length > 0)).toBe(true);
  expect([...written]).toEqual(
    expect.arrayContaining([
      'installation.admitted',
      'installation.rejected',
      'installation.deleted',
      'repository.added',
      'repository.enabled',
    ]),
  );
});

test('every action a call site writes is a member of AUDIT_ACTIONS and every member is written or reserved', () => {
  expect(usageProblems(AUDIT_ACTIONS, written, RESERVED_ACTIONS)).toEqual([]);
});

test('every call site has fixtures that write the same actions and the same metadata keys as the call', () => {
  expect(fixtureProblems(sites, SITE_FIXTURES)).toEqual([]);
});

const ALLOWED_KEYS: ReadonlySet<string> = new Set(AUDIT_METADATA_KEYS);

test('every metadata key a call site can write is on the allowlist of the zod schema and of the database check', async () => {
  const keys = [...new Set(sites.flatMap((site) => site.metadataKeys))];
  expect(keys.length).toBeGreaterThan(0);
  expect(keys.filter((key) => !ALLOWED_KEYS.has(key))).toEqual([]);
  const { db } = await migratedTestDatabase();
  const refused: string[] = [];
  for (const key of keys) {
    const answer = await sql<{
      clean: boolean;
    }>`select audit_metadata_is_clean(jsonb_build_object(${key}::text, 1)) as clean`.execute(db);
    if (answer.rows[0]?.clean !== true) {
      refused.push(key);
    }
  }
  expect(refused).toEqual([]);
});

test.each(Object.entries(SITE_FIXTURES))(
  'the rows %s writes pass the zod schema and the database check when inserted',
  async (_site, fixtures) => {
    const { db } = await migratedTestDatabase();
    const tenant = await seedTenant(db);
    for (const fixture of fixtures) {
      expect(auditMetadataSchema.safeParse(fixture.metadata ?? {}).success).toBe(true);
      await db.transaction().execute((trx) => appendAudit(trx, entryOf(fixture, tenant.installationId)));
    }
    const rows = await db.selectFrom('audit_log').select(['action', 'metadata']).orderBy('id').execute();
    expect(rows).toEqual(fixtures.map((fixture) => ({ action: fixture.action, metadata: fixture.metadata ?? {} })));
    const clean = await sql<{
      clean: boolean;
    }>`select bool_and(audit_metadata_is_clean(metadata)) as clean from audit_log`.execute(db);
    expect(clean.rows).toEqual([{ clean: true }]);
  },
);
