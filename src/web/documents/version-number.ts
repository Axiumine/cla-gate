// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { VersionBump } from '../../shared/cla-version.ts';

// How a version number is written and which one a publish would give (E18-S05). The numbering is the server's (`publishVersion`):
// what is computed here is shown before the request and is never sent.

/** A version number: `major.minor`. */
export interface VersionNumber {
  readonly major: number;
  readonly minor: number;
}

/** `2.1` for major 2, minor 1. */
export function formatVersion(version: VersionNumber): string {
  return `${version.major}.${version.minor}`;
}

/**
 * The number the next version would take: `(major + 1).0` for a major bump, `major.(minor + 1)` for a minor one, and `1.0` for
 * a document with no version, which can only be published as a major one.
 */
export function nextVersion(active: VersionNumber | null, bump: VersionBump): VersionNumber {
  if (active === null) {
    return { major: 1, minor: 0 };
  }
  return bump === 'major' ? { major: active.major + 1, minor: 0 } : { major: active.major, minor: active.minor + 1 };
}
