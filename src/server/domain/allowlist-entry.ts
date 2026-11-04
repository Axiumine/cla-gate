// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ALLOWLIST_LOGIN_PATTERN } from '../../shared/allowlist.ts';

// The two decisions of adding an allowlist entry that need no I/O (E14-S06): whether the account GitHub found is the kind of
// account the entry asks for, and whether a login may be kept as a snapshot. The caller reads GitHub and the database and
// passes what they say; nothing is read here.

/** What GitHub says an account is. `Other` is any type the platform has no word for. */
type AccountType = 'User' | 'Bot' | 'Organization' | 'Other';

/** The kinds of entry that name a login (`org_members` names the installation's own organisation and needs no lookup). */
type NamedKind = 'user' | 'bot';

/**
 * Whether the account of type `type` is what an entry of `kind` exempts: a person for `user`, a bot for `bot`. `use_org_members`
 * is the answer for an organisation, which no named kind accepts but which has a kind of its own, so the client is told which;
 * `use_other_kind` is a person given as a bot or a bot given as a person; `not_supported` is a type of account no kind exempts.
 */
export function checkAccountKind(
  kind: NamedKind,
  type: AccountType,
): 'ok' | 'use_org_members' | 'use_other_kind' | 'not_supported' {
  if (type === 'Organization') {
    return 'use_org_members';
  }
  if (type === 'Other') {
    return 'not_supported';
  }
  const wanted = kind === 'user' ? 'User' : 'Bot';
  return type === wanted ? 'ok' : 'use_other_kind';
}

/**
 * The login to keep as the display snapshot of an entry: `login` when it has the shape of a GitHub login, else none. The text may
 * come from GitHub or from our own table; either way only that shape reaches a column a screen shows.
 */
export function snapshotOf(login: string): string | null {
  return ALLOWLIST_LOGIN_PATTERN.test(login) ? login : null;
}
