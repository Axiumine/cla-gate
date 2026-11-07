// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { expect } from 'vitest';
import { z } from 'zod';
import { DATA_EXPORT_PATH, dataExportSchema } from '../../../../shared/data-export.ts';
import type { Database } from '../../db/schema.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { matrixWorld } from '../cross-tenant-runner/test-support.ts';

// The world of the tests of the data subject export (E16-S06): the two tenants of the cross-tenant matrix with five people
// who are logged in, a call of the export as one of them, and the rows the export reads that the seed leaves out.

/** The instant the clock of the test world stands at (the fixture of the authentication tests): the `exportedAt` of every document. */
export const EXPORTED_AT = '2026-11-02T10:00:00.000Z';

/** The matrix world with `get(who, query)`: the export as that person (nobody: no session) and `exported(who)`, the checked document. */
export async function exportWorld() {
  const state = await matrixWorld();
  const get = (who: PersonName | null, query = '') =>
    state.ask(who, { method: 'GET', url: `${DATA_EXPORT_PATH}${query}` });
  /** The document of a person: the answer is a `200` and the body is what `dataExportSchema` describes. */
  const exported = async (who: PersonName) => {
    const response = await get(who);
    expect(response.statusCode, `the export of ${who}`).toBe(200);
    return dataExportSchema.parse(response.json());
  };
  return { ...state, get, exported };
}

/** The audit rows `data_export.created`, oldest first, as the table stores them. */
export async function exportAuditRows(db: Kysely<Database>) {
  return db
    .selectFrom('audit_log')
    .select(['installation_id', 'actor_github_id', 'subject_type', 'subject_id', 'metadata'])
    .where('action', '=', 'data_export.created')
    .orderBy('id')
    .execute();
}

/** The GitHub id of the person the content tests export: a stranger to the five of the matrix, who signs in both tenants. */
export const ADA = 4242;

/** The first publisher of the seed (`seedTenant`): the person who revokes Ada's signatures and makes her allowlist entries. */
export const REVOKER = 1001;

/**
 * The export world with a sixth person, `Ada Lovelace` (login `ada`, created at a fixed instant), who is logged in. `getAda()`
 * is her export. She has no signature yet: the tests seed them with `seedSignatures` against `t1` or `t2`.
 */
export async function adaWorld() {
  const state = await exportWorld();
  const session = await state.login(ADA);
  await state.db
    .updateTable('users')
    .set({ login: 'ada', name: 'Ada Lovelace', created_at: new Date('2026-09-01T08:00:00.000Z') })
    .where('github_id', '=', ADA)
    .execute();
  const getAda = () => state.app.inject({ method: 'GET', url: DATA_EXPORT_PATH, headers: { cookie: session.cookie } });
  /** Ada's checked document. */
  const exportedAda = async () => {
    const response = await getAda();
    expect(response.statusCode, 'the export of Ada').toBe(200);
    return dataExportSchema.parse(response.json());
  };
  return { ...state, getAda, exportedAda };
}

const rawObject = z.record(z.string(), z.unknown());

/**
 * The document as the wire carries it, as plain objects: the schema drops what it does not know, so a field that should not be
 * there (who revoked a signature) is looked for here, in what was sent.
 */
export function rawDocument(body: unknown) {
  const document = rawObject.parse(body);
  return {
    keys: Object.keys(document),
    signatures: z.array(rawObject).parse(document['signatures']),
    corporateAgreements: z.array(rawObject).parse(document['corporateAgreements']),
    corporateApprovals: z.array(rawObject).parse(document['corporateApprovals']),
    allowlistEntries: z.array(rawObject).parse(document['allowlistEntries']),
    auditEntries: z.array(rawObject).parse(document['auditEntries']),
  };
}
