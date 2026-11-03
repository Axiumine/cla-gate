// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { VersionBump } from '../../shared/cla-version.ts';

// How the versions of a CLA document are numbered (E12-S04). Pure: the service reads the active version under the lock of the
// document and asks here which number the next one takes. A major bump forces everyone to sign again, a minor one does not, and
// the first version of a document is always a major one, so a document never starts at `0.x`.

/** A version number: `major.minor`. */
export interface VersionNumber {
  readonly major: number;
  readonly minor: number;
}

/** What {@link nextVersionNumber} decided: the number, or the one rule the bump broke. */
export type NextVersion =
  | { readonly ok: true; readonly number: VersionNumber }
  | { readonly ok: false; readonly rule: 'first_version_must_be_major' };

/**
 * The number the next version of a document takes. The active version is always the latest of its document (the database
 * refuses to point at anything else), so the next number follows from it alone: a `major` bump gives `(major + 1).0`, a `minor`
 * bump gives `major.(minor + 1)`. A document with no active version starts at `1.0` and only with a `major` bump.
 */
export function nextVersionNumber(active: VersionNumber | null, bump: VersionBump): NextVersion {
  if (active === null) {
    return bump === 'major'
      ? { ok: true, number: { major: 1, minor: 0 } }
      : { ok: false, rule: 'first_version_must_be_major' };
  }
  return {
    ok: true,
    number: bump === 'major' ? { major: active.major + 1, minor: 0 } : { major: active.major, minor: active.minor + 1 },
  };
}
