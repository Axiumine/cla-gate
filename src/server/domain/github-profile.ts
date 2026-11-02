// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { VerifiedEmail } from '../../shared/verified-email.ts';

// What the login keeps of the GitHub account that just signed in (E10-S05), pure. The identity is the numeric id; the login,
// the name and the avatar are display snapshots that a person controls, so each is bounded here before it is stored.

/** GitHub's rule for a username: letters, digits and single hyphens, at most 39 characters, never starting with a hyphen. */
export const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** The longest display name stored: 255 characters, counted as Unicode code points so a cut never splits an emoji. */
const MAX_NAME = 255;

/** The only origin an avatar may come from: the origin the dashboard's image policy accepts (E17). */
const AVATAR_ORIGIN = 'https://avatars.githubusercontent.com';

/** No avatar address of GitHub's is anywhere near this long; a longer one is not stored. */
const MAX_AVATAR = 2048;

/** The most verified addresses a session keeps (the column's check, `sessions_verified_emails_check`). */
const MAX_EMAILS = 20;

/** The name as GitHub spells it, cut to 255 code points. Nothing else is changed: a hostile name is stored verbatim. */
export function cutName(name: string): string {
  const points = Array.from(name);
  return points.length > MAX_NAME ? points.slice(0, MAX_NAME).join('') : name;
}

/**
 * The avatar address when it is on GitHub's avatar host over HTTPS, else null. The address is rebuilt from its parts, so
 * credentials (`https://avatars.githubusercontent.com@evil.example/` has another host, but `https://user:pw@avatars...`
 * has this one) and a fragment never reach the database.
 */
export function avatarOrNull(raw: string | null): string | null {
  if (raw === null || raw.length > MAX_AVATAR) {
    return null;
  }
  try {
    const url = new URL(raw);
    return url.origin === AVATAR_ORIGIN ? `${url.origin}${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
}

/** One address as `GET /user/emails` reports it. */
export interface ReportedEmail {
  readonly email: string;
  readonly primary: boolean;
  readonly verified: boolean;
}

/** The verified addresses, in the order GitHub gave them, at most 20, each with its `primary` flag. */
export function verifiedOnly(reported: readonly ReportedEmail[]): VerifiedEmail[] {
  return reported
    .filter((address) => address.verified)
    .slice(0, MAX_EMAILS)
    .map(({ email, primary }) => ({ email, primary }));
}
