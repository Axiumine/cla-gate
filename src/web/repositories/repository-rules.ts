// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ClaRule } from '../../shared/cla.ts';
import { ApiError } from '../api/index.ts';
import { isRule } from '../documents/document-rules.ts';
import { isSuspended } from '../pending/override-rules.ts';

// The rules of attaching a document (E14-S02) and of turning enforcement on (E14-S03) that the Repositories screen shows in words of its
// own (E18-S10). A rule is told by the status and the code of the error body together, never by anything the server wrote as text;
// any other failure goes through the general error state, which says what a `403`, a limit or GitHub being down mean.

/**
 * The rules about the document or the repository, each with the catalog key `repositories.rule.<rule>`. `installation_suspended` is the
 * tenant guard's own answer and is told below.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const REPOSITORY_RULES = [
  'document_not_attachable',
  'document_unpublished',
  'repository_enabled',
  'no_active_cla',
] as const satisfies readonly ClaRule[];

/** A rule the screen shows as a whole: one of {@link REPOSITORY_RULES}, or the tenant being suspended. */
export type RepositoryRule = (typeof REPOSITORY_RULES)[number] | 'installation_suspended';

/** The rule of the call that `error` is, when it is one the screen tells in words of its own. */
export function repositoryRuleOf(error: unknown): RepositoryRule | undefined {
  return isSuspended(error) ? 'installation_suspended' : REPOSITORY_RULES.find((rule) => isRule(error, rule));
}

/** The server answers `404` for a repository the installation does not have: gone already, or another tenant's, which it never says apart. */
export function isGone(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}
