// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';

// E18-S12: the people of the seeded world. Every value is made up. A person is their numeric GitHub id (the identity); the
// login and the name are display snapshots. The `users.id` is a number of its own, in a range the identity sequence of a
// running server will not reach, so a seeded row never meets a row the application inserts.

export interface Person {
  /** `users.id`. */
  readonly rowId: number;
  /** The identity. */
  readonly githubId: number;
  readonly login: string;
  readonly name: string;
  /** The verified addresses GitHub would have reported at login, which the session keeps for the signing page. */
  readonly emails: readonly { readonly email: string; readonly primary: boolean }[];
  /** The value of the session cookie of this person: 43 base64url characters, derived from the login, a secret of nothing. */
  readonly cookie: string;
}

/** `ids` are the row id and the GitHub id, in that order. */
function person(ids: readonly [number, number], login: string, name: string, emails: readonly string[]): Person {
  const [rowId, githubId] = ids;
  return {
    rowId,
    githubId,
    login,
    name,
    emails: emails.map((email, index) => ({ email, primary: index === 0 })),
    cookie: createHash('sha256').update(`cla-e2e-session:${login}`).digest('base64url'),
  };
}

/** The maintainer: owner of the user account `alice-oss`, so an org admin of it (E11-S02) with no call to GitHub. */
export const ALICE = person([100_001, 4_100_101], 'alice-maintainer', 'Alice Maintainer', ['alice@example.test']);
/** The owner of another tenant, whose data the maintainer must never see. */
export const BOB = person([100_002, 4_100_202], 'bob-owner', 'Bob Owner', ['bob@example.test']);
/** A contributor who signed the current major of the CLA. */
export const CAROL = person([100_003, 4_100_303], 'carol-contributor', 'Carol Contributor', ['carol@example.test']);
/** A contributor who signed the first major, which a newer one has replaced. */
export const DAN = person([100_004, 4_100_404], 'dan-developer', 'Dan Developer', ['dan@example.test']);
/** A contributor whose signature was revoked. */
export const ERIN = person([100_005, 4_100_505], 'erin-engineer', 'Erin Engineer', ['erin@example.test']);
/** A contributor who has not signed anything, with two verified addresses to choose from. */
export const FRANK = person([100_006, 4_100_606], 'frank-newcomer', 'Frank Newcomer', [
  'frank@example.test',
  'frank.n@example.test',
]);
/** A person on the allowlist of the tenant. */
export const GRACE = person([100_007, 4_100_707], 'grace-trusted', 'Grace Trusted', ['grace@example.test']);
/** An automation account on the allowlist of the tenant. */
export const BOT = person([100_008, 4_100_808], 'release-bot[bot]', 'Release Bot', []);

/** Everyone of the seeded world, in the order their rows are written. */
export const EVERYONE: readonly Person[] = [ALICE, BOB, CAROL, DAN, ERIN, FRANK, GRACE, BOT];
