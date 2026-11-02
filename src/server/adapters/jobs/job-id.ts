// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';

// The id of a job sent under an idempotency key (E07-S01). pg-boss keys a job on (queue, id), so a job whose id is a pure
// function of the key can be sent once: a second send under the same key meets the first one's row and creates nothing.

/**
 * A UUID made from `idempotencyKey` alone (SHA-256 of a fixed prefix and the key; version nibble 5 and the RFC 4122
 * variant, as a name-based UUID has them). The same key always gives the same id, and the prefix keeps the ids of this
 * application apart from any other use of the same hash.
 */
export function jobIdFor(idempotencyKey: string): string {
  const hex = createHash('sha256').update(`cla-gate:job:${idempotencyKey}`, 'utf8').digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
