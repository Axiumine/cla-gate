// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Account } from './types.ts';

// E08-S03: how the engine tells a person from a bot. The answer comes from the account type GitHub reported and from
// nothing else. A login such as `dependabot[bot]` is text that anyone can register, and an app slug is display metadata,
// so neither can make an account a bot (or stop it being one).

/**
 * The four ways the rules treat an account. `unknown` is a co-author resolved from a trailer, whose type GitHub never
 * told us (E08-S06): the allowlist and signature rules accept it where either a person or a bot could be meant. `other`
 * is an organisation or a mannequin (an unclaimed placeholder account): neither can sign, but a maintainer may allowlist
 * one by id.
 */
export type AccountClass = 'bot' | 'human' | 'unknown' | 'other';

/** Classifies an account by its type alone. The parameter type says so: no id, slug, login or email is readable here. */
export function classifyAccount(account: Pick<Account, 'type'>): AccountClass {
  switch (account.type) {
    case 'Bot':
      return 'bot';
    case 'User':
      return 'human';
    case 'Unknown':
      return 'unknown';
    case 'Organization':
    case 'Mannequin':
      return 'other';
  }
}
