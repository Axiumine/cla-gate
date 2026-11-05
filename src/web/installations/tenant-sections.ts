// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationRole } from '../../shared/installations.ts';

// The screens below an installation and where the tenant switcher takes the person (E18-S04). Choosing another installation keeps
// the person on the same screen when the other installation has it, and sends them to the start of that installation otherwise.

/** The `to` of every screen below an installation that the switcher can keep the person on. Each story that adds one adds it here. */
export type TenantTo = '/installations/$installationId';

/** One screen below an installation and the roles that can open it. */
export interface TenantSection<To extends string> {
  readonly to: To;
  readonly roles: readonly InstallationRole[];
}

/**
 * Where a tenant starts: the screen the switcher falls back to. Today it is the overview of the installation; the repository list
 * (E18-S10) takes its place there when it lands.
 */
export const TENANT_START: TenantTo = '/installations/$installationId';

/** The screens below an installation, with the roles that can open each. The overview is for every role in the installation. */
export const TENANT_SECTIONS: readonly TenantSection<TenantTo>[] = [
  { to: '/installations/$installationId', roles: ['org_admin', 'repo_admin'] },
];

/** A path as the router spells a matched route: an index route ends in a slash, which the table does not write. */
function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Where the switcher takes a person who is on the route `here` when they choose an installation in which they hold `role`: the
 * same screen when `sections` has it and lets that role open it, else `start`.
 */
export function switchTarget<To extends string>(
  sections: readonly TenantSection<To>[],
  start: To,
  here: string | undefined,
  role: InstallationRole,
): To {
  const current = here === undefined ? undefined : withoutTrailingSlash(here);
  const section = sections.find((candidate) => candidate.to === current);
  return section?.roles.includes(role) === true ? section.to : start;
}
