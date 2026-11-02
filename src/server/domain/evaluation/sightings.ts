// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ExtractedActor } from './actor-types.ts';
import { compareText } from './order.ts';
import { type Account, type AccountType, ROLES, type Role } from './types.ts';

// E08-S02: the bookkeeping behind actor extraction. One sighting per numeric id collects the roles an account plays
// and the commits it appears in; nothing here knows what a commit is.

export interface Sighting {
  account: Account;
  readonly roles: Set<Role>;
  readonly shas: Set<string>;
}

/**
 * Account types from the strictest reading to the loosest. Real GitHub data gives one type per id, but if two sightings
 * of an id disagree the engine keeps the strictest one, so the answer does not depend on the order of the commits.
 */
const TYPE_STRICTNESS: readonly AccountType[] = ['Bot', 'Mannequin', 'Organization', 'User', 'Unknown'];

function accountKey(account: Account): string {
  const slug = account.appSlug === undefined ? '0' : `1${account.appSlug}`;
  return `${TYPE_STRICTNESS.indexOf(account.type)}|${slug}`;
}

function preferred(a: Account, b: Account): Account {
  return accountKey(a) <= accountKey(b) ? a : b;
}

/** Notes that `account` plays `role`, in the commit `sha` when there is one (the opener is in no commit by being it). */
export function recordSighting(sightings: Map<number, Sighting>, account: Account, role: Role, sha?: string): void {
  const sighting = sightings.get(account.id) ?? { account, roles: new Set<Role>(), shas: new Set<string>() };
  sighting.account = preferred(sighting.account, account);
  sighting.roles.add(role);
  if (sha !== undefined) {
    sighting.shas.add(sha);
  }
  sightings.set(account.id, sighting);
}

/** The sightings as actors: sorted by numeric id, roles in the order of the closed ROLES list, SHAs sorted. */
export function sightingsToActors(sightings: ReadonlyMap<number, Sighting>): ExtractedActor[] {
  return [...sightings.values()]
    .sort((a, b) => a.account.id - b.account.id)
    .map((sighting) => ({
      account: sighting.account,
      roles: ROLES.filter((role) => sighting.roles.has(role)),
      shas: [...sighting.shas].sort(compareText),
    }));
}
