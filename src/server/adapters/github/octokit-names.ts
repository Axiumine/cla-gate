// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { GitHubNotFoundError } from '../../services/ports/github-errors.ts';

// What the installation-level reads of the Octokit adapter check before a request is built (E07-S10): a repository name and a
// commit SHA become parts of a path or a query, so text GitHub cannot hold is answered without a request.

/** Commits per page of a listing, the most GitHub gives. */
export const PER_PAGE = 100;

/** The owner of a repository: a name GitHub can hold as an account. */
const OWNER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/** The name of a repository, which is never `.` or `..` (checked apart: those would walk a path). */
const REPOSITORY = /^[A-Za-z0-9._-]{1,100}$/;

/** A SHA-1 or SHA-256 commit id in lower case: the only text of a commit that reaches a path or a query. */
export const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export interface RepositoryName {
  readonly owner: string;
  readonly repo: string;
}

/** The owner and the name of `fullName` (`owner/name`), or null for text GitHub cannot hold as a repository name. */
export function repositoryOf(fullName: string): RepositoryName | null {
  const parts = fullName.split('/');
  const [owner = '', repo = ''] = parts;
  const valid = parts.length === 2 && OWNER.test(owner) && REPOSITORY.test(repo) && repo !== '.' && repo !== '..';
  return valid ? { owner, repo } : null;
}

/**
 * The repository `fullName` names, and every SHA of `shas` checked.
 * @throws GitHubNotFoundError for a name or a SHA that cannot exist, naming the route; no request is made for it.
 */
export function checked(route: string, fullName: string, shas: readonly string[] = []): RepositoryName {
  const name = repositoryOf(fullName);
  if (name === null || !shas.every((sha) => COMMIT_SHA.test(sha))) {
    throw new GitHubNotFoundError(route);
  }
  return name;
}
