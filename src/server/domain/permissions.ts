// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { INSTALLATION_PERMISSIONS } from '../../shared/github-app.ts';

// The permissions an installation must grant for the platform to work (E05-S08): the minimum of the settings table in
// docs/github-app.md, as the keys GitHub puts in the `permissions` object of an installation. Pure: the caller passes
// what GitHub reported and gets back the names that fall short; nothing is read or logged here.

/** GitHub's access levels, lowest first; a higher level includes the lower ones (`admin` can do what `write` can). */
const LEVELS: ReadonlyMap<string, number> = new Map([
  ['read', 1],
  ['write', 2],
  ['admin', 3],
]);

/**
 * The lowest level of each permission the platform needs, in the order the warning lists them: the permissions of an
 * installation that the GitHub App is created with (E19-S06), the very constant the App manifest is built from.
 */
const MINIMUM: readonly (readonly [name: string, level: string])[] = Object.entries(INSTALLATION_PERMISSIONS);

const rank = (level: string | undefined): number => (level === undefined ? 0 : (LEVELS.get(level) ?? 0));

/**
 * The permissions among the minimum that `granted` (permission name to level, as GitHub reports it) does not reach: absent,
 * below the needed level, or at a level this code does not know. Empty when the installation grants enough.
 */
export function missingPermissions(granted: Readonly<Record<string, string>>): string[] {
  const levels = new Map(Object.entries(granted));
  return MINIMUM.filter(([name, level]) => rank(levels.get(name)) < rank(level)).map(([name]) => name);
}
