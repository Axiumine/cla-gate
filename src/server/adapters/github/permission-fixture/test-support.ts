// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import type { GitHubRepositoryPermission } from '../../../services/ports/github.ts';
import { GitHubForbiddenError, GitHubRateLimitedError } from '../../../services/ports/github-errors.ts';
import { VIEWER_ID } from '../../../services/role-fixture/test-support.ts';
import { json, type RouteAnswer } from '../client-fixture/test-support.ts';
import type { repositoryPermissionSchema } from '../schemas.ts';

// The contract fixtures of `GET /repos/{owner}/{repo}/collaborators/{username}/permission` (E11-S03): what GitHub answers
// to the one permission call, as the HTTP boundary sees it, with what the adapter makes of each answer and what the
// repository admin lookup makes of that, for the viewer of the role tests (numeric id 501, login `alice`, repository
// `acme/api`). They are the counterpart of the membership fixtures of E11-S02, with the same error classes. The bodies are
// typed through the zod schema the adapter reads them with, so a fixture the schema would refuse does not compile.

/** The fields of an answer the adapter reads, spelled as GitHub spells them, and `role_name`, which it ignores. */
type PermissionFields = z.input<typeof repositoryPermissionSchema> & { readonly role_name: string };

/** A permission answer as GitHub sends it: the fields the schema reads, and the ones the platform ignores. */
function permissionBody(fields: PermissionFields): Record<string, unknown> {
  return {
    ...fields,
    user: { login: 'alice', type: 'User', site_admin: false, ...fields.user },
  };
}

/** What the GitHub client port does with an answer: returns this (null for "no such person or repository"), or throws this. */
type PortOutcome =
  | { readonly returns: GitHubRepositoryPermission | null }
  | { readonly throws: typeof GitHubForbiddenError | typeof GitHubRateLimitedError };

/** What the repository admin lookup does with an answer: resolves whether the viewer is an admin, or throws the rate limit. */
type LookupOutcome =
  | { readonly admin: boolean; readonly permissionMissing: boolean }
  | { readonly limitedForSeconds: number };

export interface PermissionFixture {
  readonly name: string;
  readonly answer: RouteAnswer;
  readonly port: PortOutcome;
  readonly lookup: LookupOutcome;
}

/** The numeric id GitHub gives to whoever holds the login `alice` now, after the viewer's account gave it up. */
const NEW_HOLDER_ID: GithubId = parseGithubId(VIEWER_ID + 1);

const permission = (level: GitHubRepositoryPermission['permission'], userId: GithubId): GitHubRepositoryPermission => ({
  permission: level,
  userId,
});

const notAdmin: LookupOutcome = { admin: false, permissionMissing: false };

/** A level that GitHub answers for the viewer, with `role_name` as GitHub names the role of that level. */
const level = (name: string, level_: GitHubRepositoryPermission['permission']): PermissionFixture => ({
  name,
  answer: () => json(permissionBody({ permission: level_, role_name: level_, user: { id: VIEWER_ID } })),
  port: { returns: permission(level_, VIEWER_ID) },
  lookup: level_ === 'admin' ? { admin: true, permissionMissing: false } : notAdmin,
});

export const PERMISSION_FIXTURES: readonly PermissionFixture[] = [
  level('the admin permission', 'admin'),
  level('the maintain permission', 'maintain'),
  level('the write permission', 'write'),
  level('the triage permission', 'triage'),
  level('the read permission', 'read'),
  level('no permission at all (none)', 'none'),
  {
    name: 'a custom role on top of write, whose role_name says admin',
    answer: () => json(permissionBody({ permission: 'write', role_name: 'admin', user: { id: VIEWER_ID } })),
    port: { returns: permission('write', VIEWER_ID) },
    lookup: notAdmin,
  },
  {
    name: 'a custom role on top of admin, whose role_name is something else',
    answer: () => json(permissionBody({ permission: 'admin', role_name: 'release-captain', user: { id: VIEWER_ID } })),
    port: { returns: permission('admin', VIEWER_ID) },
    lookup: { admin: true, permissionMissing: false },
  },
  {
    name: 'a 404, no such repository or person (a renamed repository, a stale name)',
    answer: () => json({ message: 'Not Found' }, 404),
    port: { returns: null },
    lookup: notAdmin,
  },
  {
    name: 'a 403, the permission to read collaborators is missing',
    answer: () => json({ message: 'Resource not accessible by integration' }, 403),
    port: { throws: GitHubForbiddenError },
    lookup: { admin: false, permissionMissing: true },
  },
  {
    name: 'a 403 that is a rate limit, the budget is used up',
    answer: () =>
      json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'retry-after': '120' }),
    port: { throws: GitHubRateLimitedError },
    lookup: { limitedForSeconds: 120 },
  },
  {
    name: 'an id mismatch, the login now belongs to someone else',
    answer: () => json(permissionBody({ permission: 'admin', role_name: 'admin', user: { id: NEW_HOLDER_ID } })),
    port: { returns: permission('admin', NEW_HOLDER_ID) },
    lookup: notAdmin,
  },
];
