// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';

// What a cached role answer is about (E11-S04): numbers and nothing else. No login, name or email is ever part of a key.

/** What a role is about: the whole installation (`org`), or one repository by its GitHub id (`repo:{githubRepoId}`). */
export type RoleScope = 'org' | `repo:${number}`;

/** The scope of the organisation-wide fact. */
export const ORG_SCOPE: RoleScope = 'org';

/** The scope of the fact about one repository, by its numeric GitHub id (`repositories.github_repo_id`). */
export function repoScope(githubRepoId: GithubId): RoleScope {
  return `repo:${githubRepoId}`;
}

/**
 * What one answer is about: `installationId` is `installations.id`, the tenant key (never GitHub's installation id), and
 * `viewerGithubId` the numeric identity of the person.
 */
export interface RoleKey {
  readonly installationId: InstallationRowId;
  readonly viewerGithubId: GithubId;
  readonly scope: RoleScope;
}

/** The key as one string, for a map: two numbers and the scope, which cannot be mistaken for another key. */
export const roleKeyText = (key: RoleKey): string => `${key.installationId}:${key.viewerGithubId}:${key.scope}`;
