// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../adapters/db/schema.ts';
import { type OwnSignature, toOwnSignature } from './own-signature-item.ts';
import { type OwnSignaturePosition, type OwnSignatureRequest, ownSignatureRows } from './own-signatures-queries.ts';

// The list of a person's own signatures (E13-S06): one page of the stored rows, each turned into the item the "my signatures" screen
// shows (own-signature-item.ts). The person is named by the caller, which takes them from the session; nothing here reads a tenant.

/** A page of the list: its signatures, and where the next page starts (`null` on the last page). */
export interface OwnSignaturePage {
  readonly items: readonly OwnSignature[];
  readonly next: OwnSignaturePosition | null;
}

/**
 * One page of the signatures of the person (`users.id`) in every tenant, newest first. The person is whoever the session names and
 * nothing in the request can change that. `next` is the row the following page starts at, or `null` when this is the last page.
 */
export async function listOwnSignatures(
  db: Kysely<Database>,
  userId: number,
  request: OwnSignatureRequest,
): Promise<OwnSignaturePage> {
  const rows = await ownSignatureRows(db, userId, request);
  const [following] = rows.slice(request.limit);
  return {
    items: rows.slice(0, request.limit).map(toOwnSignature),
    next: following === undefined ? null : { signedAt: following.signedAtMicros, id: following.id },
  };
}
