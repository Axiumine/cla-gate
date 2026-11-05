// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ClaRule } from '../../shared/cla.ts';
import { ApiError } from '../api/index.ts';
import { isRule } from '../documents/document-rules.ts';

// The rules of recording an override (E15-S05) that the dialog of E18-S08 shows in words of its own. A rule is told by the status and
// the code of the error body together, never by anything the server wrote as text; any other failure goes through the general error
// state, which says what a `403`, a limit or GitHub being down mean.

/**
 * The rules about the commit or the repository, each with the catalog key `pending.rule.<rule>`. `invalid_commit_sha` and
 * `invalid_reason` are about a field and show under it; `installation_suspended` is the tenant guard's own answer and is told below.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const OVERRIDE_RULES = [
  'commit_not_found',
  'override_exists',
  'repository_disabled',
] as const satisfies readonly ClaRule[];

/** A rule the dialog shows as a whole: one of {@link OVERRIDE_RULES}, or the tenant being suspended. */
export type OverrideRule = (typeof OVERRIDE_RULES)[number] | 'installation_suspended';

/** `409 installation_suspended`: the tenant guard refuses every write of a suspended installation. It is no rule of the documents API. */
function isSuspended(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && error.code === 'installation_suspended';
}

/** The rule of the record that `error` is, when it is one the dialog tells in words of its own. */
export function overrideRuleOf(error: unknown): OverrideRule | undefined {
  return isSuspended(error) ? 'installation_suspended' : OVERRIDE_RULES.find((rule) => isRule(error, rule));
}
