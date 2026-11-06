// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ClaRule } from '../../shared/cla.ts';
import { isRule } from '../documents/document-rules.ts';

// The rules of adding an allowlist entry (E14-S06) that the add dialog of E18-S06 shows in words of its own. A rule is told by the
// status and the code of the error body together (`isRule`), never by anything the server wrote as text; any other failure goes through
// the general error state.

/**
 * The rules an add can break, each with the catalog key `allowlist.rule.<rule>`. `github_account_not_found` and `kind_mismatch` are about the
 * login the person typed and show under it; the other three are about the entry as a whole and show in the dialog.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const ADD_RULES = [
  'github_account_not_found',
  'kind_mismatch',
  'allowlist_entry_exists',
  'no_organization',
  'members_permission_missing',
] as const satisfies readonly ClaRule[];

export type AddRule = (typeof ADD_RULES)[number];

/** The rules that are about the login field. */
const LOGIN_RULES: readonly AddRule[] = ['github_account_not_found', 'kind_mismatch'];

/** The rule of the add that `error` is, when it is one of {@link ADD_RULES}. */
export function addRuleOf(error: unknown): AddRule | undefined {
  return ADD_RULES.find((rule) => isRule(error, rule));
}

/** The rule of `error` that belongs under the login field, or `undefined`. */
export function loginRuleOf(error: unknown): AddRule | undefined {
  const rule = addRuleOf(error);
  return rule !== undefined && LOGIN_RULES.includes(rule) ? rule : undefined;
}
