// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import type { EraseArguments } from '../domain/erase-arguments.ts';
import { type ErasedInstallation, type ErasureOutcome, erasureHolds, isErased } from '../domain/operator-erasure.ts';
import { eraseInInstallation, readSignerFootprint } from './operator-erasure-queries.ts';

// The operator's erasure of a person's personal data (E22-S05), over every installation of the server. The erasure itself is the
// SQL function of E16-S04, called once per installation in which the person has signatures, each call in its own transaction;
// this module decides whether to call it, in what order, and whether the result is what an erasure must leave. It contains no
// statement that changes a row.

/** What the operator asks: the person, the operator who asks (the actor of the audit rows) and whether to go ahead or only look. */
export type OperatorErasureRequest = EraseArguments;

/**
 * Runs the erasure the request asks for and says what came of it. The footprint of the person is read first: a GitHub id with
 * no `users` row is `unknown`; a person with no `signer_pii` row anywhere and the snapshot already scrubbed is `nothing`, and
 * nothing is called or written, so a repeat is safe. A dry run stops there with the counts. A real run calls the function for the
 * installations in ascending order and stops at the first failure (`failed`, with the installations done and those pending; the
 * ones done stay done, and a run again finds them with no rows left). After the last call the footprint is read once more and
 * must hold the post-conditions of {@link erasureHolds}, else the outcome is `mismatch`; a failure of that read is `failed` too,
 * with every installation done and none pending.
 * @throws whatever the first read throws: nothing was changed then.
 */
export async function runOperatorErasure(
  db: Kysely<Database>,
  request: OperatorErasureRequest,
): Promise<ErasureOutcome> {
  const before = await readSignerFootprint(db, request.githubId);
  if (!before.known) {
    return { kind: 'unknown' };
  }
  if (isErased(before)) {
    return { kind: 'nothing' };
  }
  if (!request.execute) {
    return { kind: 'dry_run', before };
  }
  const erased: ErasedInstallation[] = [];
  try {
    for (const installation of before.installations) {
      erased.push({
        installationId: installation.installationId,
        deleted: await eraseInInstallation(db, request, installation.installationId),
      });
    }
    const after = await readSignerFootprint(db, request.githubId);
    return erasureHolds(before, after) ? { kind: 'erased', before, erased } : { kind: 'mismatch', before, after };
  } catch (cause) {
    const done = erased.map((entry) => entry.installationId);
    const pending = before.installations.map((entry) => entry.installationId).filter((id) => !done.includes(id));
    return { kind: 'failed', done, pending, cause };
  }
}
