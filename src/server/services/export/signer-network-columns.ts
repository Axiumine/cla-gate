// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { z } from 'zod';
import type { Database } from '../../adapters/db/schema.ts';

// Which of the optional network columns of `signer_pii` the database has (E16-S06). The address and the user agent exist only
// once E13-S05 adds them, and are filled only when the operator switched recording on; the export of a person's own data reads
// the ones that are there, so nothing has to be redefined when that migration lands (the purge of E16-S05 looks them up the same way).

/** Whether `signer_pii.ip_address` and `signer_pii.user_agent` exist. */
export interface SignerNetworkColumns {
  readonly ipAddress: boolean;
  readonly userAgent: boolean;
}

const attributeRows = z.array(z.object({ attname: z.string() }));

/** Looks the two columns up in the catalogue, as the reading `db` sees it (inside a snapshot, the snapshot's). */
export async function signerNetworkColumns(db: Kysely<Database>): Promise<SignerNetworkColumns> {
  const { rows } = await sql`
    select attname from pg_attribute
    where attrelid = 'signer_pii'::regclass and attname in ('ip_address', 'user_agent') and attnum > 0 and not attisdropped`.execute(
    db,
  );
  const names = attributeRows.parse(rows).map((row) => row.attname);
  return { ipAddress: names.includes('ip_address'), userAgent: names.includes('user_agent') };
}
