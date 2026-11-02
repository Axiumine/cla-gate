// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type AccountClass, classifyAccount } from './classify.ts';
import {
  type Account,
  ALLOWLIST_KINDS,
  type AllowlistEntry,
  type AllowlistKind,
  type AllowlistScope,
  type EvaluationInput,
} from './types.ts';

// E08-S03: which allowlist entry, if any, covers an actor. Entries name numeric ids only. The actor is judged alone:
// membership of an organisation exempts the member, never the people who share a commit with them.

/** The facts an actor is matched on: its id, and its type through the classification. Slug and display data play no part. */
export type AllowlistSubject = Pick<Account, 'id' | 'type'>;

type OrgMembers = EvaluationInput['orgMembers'];

/**
 * Narrowest scope first: a repository's own entry is preferred to the installation-wide one. The closed list in
 * `types.ts` runs the other way round (it mirrors the database), hence the explicit order here. A switch, so a new
 * scope fails to compile until it is ranked.
 */
function scopeRank(scope: AllowlistScope): number {
  switch (scope) {
    case 'repository':
      return 0;
    case 'installation':
      return 1;
  }
}

/**
 * The account classes a kind of entry can cover. A `user` entry takes anything but a bot; a `bot` entry takes a bot, or
 * an account whose type is not known; `org_members` takes people (and the unknown), never a bot or an organisation.
 */
function coveredClasses(kind: AllowlistKind): readonly AccountClass[] {
  switch (kind) {
    case 'user':
      return ['human', 'unknown', 'other'];
    case 'bot':
      return ['bot', 'unknown'];
    case 'org_members':
      return ['human', 'unknown'];
  }
}

/** A missing organisation entry is no membership: a lookup that failed upstream can only ever deny coverage. */
function isMember(orgMembers: OrgMembers, orgId: number, userId: number): boolean {
  return orgMembers.get(orgId)?.has(userId) === true;
}

function entryApplies(entry: AllowlistEntry, actor: AllowlistSubject, orgMembers: OrgMembers): boolean {
  if (!coveredClasses(entry.kind).includes(classifyAccount(actor))) {
    return false;
  }
  return entry.kind === 'org_members' ? isMember(orgMembers, entry.githubId, actor.id) : entry.githubId === actor.id;
}

/** Repository scope first, then user, bot, org_members, then the lowest entry id. A total order, so input order is moot. */
function compareEntries(a: AllowlistEntry, b: AllowlistEntry): number {
  return (
    scopeRank(a.scope) - scopeRank(b.scope) ||
    ALLOWLIST_KINDS.indexOf(a.kind) - ALLOWLIST_KINDS.indexOf(b.kind) ||
    a.id - b.id
  );
}

/**
 * The entry that covers `actor`, or `null`. When several apply the pick is deterministic: repository scope before
 * installation scope, then kind order `user`, `bot`, `org_members`, then the lowest entry id. An entry whose kind does
 * not fit the account type never matches, whatever its id says, and an organisation absent from `orgMembers` has no
 * known members.
 */
export function matchAllowlist(
  actor: AllowlistSubject,
  entries: readonly AllowlistEntry[],
  orgMembers: OrgMembers,
): AllowlistEntry | null {
  let best: AllowlistEntry | null = null;
  for (const entry of entries) {
    if (entryApplies(entry, actor, orgMembers) && (best === null || compareEntries(entry, best) < 0)) {
      best = entry;
    }
  }
  return best;
}
