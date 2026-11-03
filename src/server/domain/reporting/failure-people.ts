// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ROLES } from '../../../shared/pr-evaluation-codes.ts';
import type { DisplayNames } from './display-names.ts';
import { renderId, renderName } from './encode.ts';
import type { ReportedEvaluation, ReportedRole } from './failure-input.ts';

// E09-S03: the people who are not covered, for the `Not signed` section. Each one appears once, keyed by the numeric GitHub id
// (a login can be recycled, an id cannot), with the login the job saw next to it and the roles the person plays.

/** What a role is called to the person who reads it. A co-author is a role of E08-S06 that the story's three words leave out. */
function roleWords(role: ReportedRole): string {
  switch (role) {
    case 'opener':
      return 'opened the PR';
    case 'author':
      return 'commit author';
    case 'committer':
      return 'committer';
    case 'co_author':
      return 'co-author';
  }
}

/** The fixes that say an account cannot sign (E08-S04), and the note that replaces the invitation to sign. */
const CANNOT_SIGN: ReadonlyMap<string, string> = new Map([
  ['allowlist_bot', 'a bot cannot sign; a maintainer can add it to the allowlist'],
  ['allowlist_account', 'this account cannot sign; a maintainer can add it to the allowlist'],
]);

/** The people of the `Not signed` section. */
export interface UnsignedPeople {
  /** One Markdown bullet per person, by numeric id. */
  readonly entries: readonly string[];
  readonly count: number;
  /** True when at least one of them can sign, so the sign link has someone to help. */
  readonly canSign: boolean;
}

/** The roles of every actor that is not covered, merged by numeric id, so a person who is two actors appears once. */
function uncoveredRoles(evaluation: ReportedEvaluation): Map<number, Set<ReportedRole>> {
  const byId = new Map<number, Set<ReportedRole>>();
  for (const actor of evaluation.actors) {
    if (!actor.covered) {
      const roles = byId.get(actor.account.id) ?? new Set<ReportedRole>();
      for (const role of actor.roles) {
        roles.add(role);
      }
      byId.set(actor.account.id, roles);
    }
  }
  return byId;
}

/** The note for each account that cannot sign, by numeric id. */
function cannotSignNotes(evaluation: ReportedEvaluation): ReadonlyMap<number, string> {
  const notes = new Map<number, string>();
  for (const fix of evaluation.fixes) {
    const note = CANNOT_SIGN.get(fix.code);
    if (note !== undefined && fix.githubId !== undefined) {
      notes.set(fix.githubId, note);
    }
  }
  return notes;
}

/** ``- `octocat` (GitHub id 583231): opened the PR, commit author``, and the note of an account that cannot sign, in brackets. */
function entryOf(login: string, id: number, roles: ReadonlySet<ReportedRole>, note: string | undefined): string {
  const phrases = ROLES.filter((role) => roles.has(role)).map(roleWords);
  const playing = phrases.length === 0 ? '' : `: ${phrases.join(', ')}`;
  const caveat = note === undefined ? '' : ` (${note})`;
  return `- ${renderName(login)} (GitHub id ${renderId(id)})${playing}${caveat}`;
}

/**
 * The accounts of the evaluation that no signature and no allowlist entry covers, by numeric id. The login is the one the job
 * saw (`names.logins`), shown as a name through `renderName`, and `(unnamed)` for an id it did not see.
 * @throws InvalidIdError for an id that is not a safe integer.
 */
export function unsignedPeople(evaluation: ReportedEvaluation, names: DisplayNames): UnsignedPeople {
  const notes = cannotSignNotes(evaluation);
  const people = [...uncoveredRoles(evaluation)].sort(([a], [b]) => a - b);
  return {
    entries: people.map(([id, roles]) => entryOf(names.logins.get(id) ?? '', id, roles, notes.get(id))),
    count: people.length,
    canSign: people.some(([id]) => !notes.has(id)),
  };
}
