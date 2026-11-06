// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { InstallationSummary } from '../../shared/installations.ts';
import type { PlainMessageKey } from '../i18n/index.ts';

/**
 * The catalog key of an account type. One `switch` with no default branch and a return type that cannot be `undefined`, so a
 * type added to the contract's enum fails `tsc` until it has words.
 */
export function accountTypeKey(accountType: InstallationSummary['accountType']): PlainMessageKey {
  switch (accountType) {
    case 'Organization':
      return 'installations.type.organization';
    case 'User':
      return 'installations.type.user';
    case 'Other':
      return 'installations.type.other';
  }
}
