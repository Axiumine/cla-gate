// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { ERASURE_PREVIEW_PATH, ERASURES_PATH } from '../../../../shared/erasure.ts';
import { insertSignature, publishSecondMajor, storePii } from '../../db/erasure-fixture/test-support.ts';
import type { Database } from '../../db/schema.ts';
import { type PersonName, tenantChecksums } from '../../db/tenant-fixture/test-support.ts';
import { matrixWorld } from '../cross-tenant-runner/test-support.ts';

// The world of the erasure route tests (E16-S04): the two tenants of the cross-tenant matrix with five people who are logged
// in, and the two calls as one of them. Tenant 1's signer is `member1` (GitHub id 31004) and tenant 2's is `admin2` (31002);
// each has one signature and one row of personal data in their own tenant.

/** The path of the preview of one installation. */
const previewPathOf = (installationId: number): string =>
  ERASURE_PREVIEW_PATH.replace(':installationId', String(installationId));

/** The path of the erasure of one installation. */
const erasuresPathOf = (installationId: number): string =>
  ERASURES_PATH.replace(':installationId', String(installationId));

/** The matrix world with `preview(who, installationId, query)` and `erase(who, installationId, payload)`: the calls as that person (nobody: no session). */
export async function erasureWorld() {
  const state = await matrixWorld();
  const preview = (who: PersonName | null, installationId: number, query = '') =>
    state.ask(who, { method: 'GET', url: `${previewPathOf(installationId)}${query}` });
  const erase = (who: PersonName | null, installationId: number, payload: object = {}) =>
    state.ask(who, { method: 'POST', url: erasuresPathOf(installationId), payload });
  /** A POST with a body exactly as given, as the org admin of tenant 1 would send it (cookie, origin and token included). */
  const eraseRaw = async (installationId: number, body: string, contentType: string) => {
    const admin = await state.login(state.people.admin1.githubId);
    return state.app.inject({
      method: 'POST',
      url: erasuresPathOf(installationId),
      headers: { ...admin.headers, 'content-type': contentType },
      payload: body,
    });
  };
  /** Every signature row as the database stores it, in a fixed order: what must not change when somebody is erased. */
  const signatureRows = async () =>
    (await sql<{ row: unknown }>`select to_jsonb(s) as row from signatures as s order by s.id`.execute(state.db)).rows;
  /** The person of tenant 1 signs again: a second major is published and signed, with the personal data held for it. */
  const signAgain = async () => {
    const version = await publishSecondMajor(state.db, state.t1);
    const signatureId = await insertSignature(state.db, state.t1, state.t1.signer, version);
    await storePii(state.db, signatureId, state.t1.signer);
    return signatureId;
  };
  return { ...state, preview, erase, eraseRaw, signatureRows, signAgain };
}

/**
 * What every tenant table holds, hashed (E11-S06), except the ledger of org admins: a call that passes the guard of a write
 * route confirms the admin with GitHub and refreshes their entry there, whatever the handler then answers. Two equal results
 * mean that no signature, personal data, audit row or other evidence changed in between.
 */
export async function dataChecksums(db: Kysely<Database>) {
  const checksums = await tenantChecksums(db);
  return Object.fromEntries(Object.entries(checksums).filter(([table]) => table !== 'installation_admin_seen'));
}
