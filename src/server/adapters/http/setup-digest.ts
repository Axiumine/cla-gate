// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Whether two strings are the same, compared the way a secret must be (E19-S06): the SHA-256 digests of both go to
 * `timingSafeEqual`, so the time taken tells nothing about how much of the value was right, and neither does its length
 * (the digests always have 32 bytes, which `timingSafeEqual` needs). Anything that is not a string is a no.
 */
export function sameSecret(expected: string, presented: unknown): boolean {
  if (typeof presented !== 'string') {
    return false;
  }
  return timingSafeEqual(
    createHash('sha256').update(expected).digest(),
    createHash('sha256').update(presented).digest(),
  );
}
