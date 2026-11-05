// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { COMMIT_SHA } from '../fake-github/test-support.ts';
import type { GitHubCommit, GitHubCommitRef } from '../ports/github.ts';

// Whether a GitHub in memory has a commit (E15-S05), shared by `FakeGitHub` and by the mocked GitHub of the Octokit adapter's tests, so that
// both answer one rule: a repository has the commits of its history and of its pull requests, as scripted, and nothing else. A SHA GitHub
// cannot hold is not a commit.

/** The commits a world scripts: the history of each repository and the commits of each pull request, keyed `<repository>` and `<repository>#<number>`. */
export interface ScriptedCommits {
  readonly repositoryCommits: ReadonlyMap<string, readonly GitHubCommit[]>;
  readonly pullCommits: ReadonlyMap<string, readonly GitHubCommit[]>;
}

/** The commit `sha` of the repository whose key is `repository` (`<installation>/<owner/name in lower case>`), or null when the world scripts none. */
export function findCommit(world: ScriptedCommits, repository: string, sha: string): GitHubCommitRef | null {
  if (!COMMIT_SHA.test(sha)) {
    return null;
  }
  const lists = [
    world.repositoryCommits.get(repository) ?? [],
    ...[...world.pullCommits].filter(([key]) => key.startsWith(`${repository}#`)).map(([, commits]) => commits),
  ];
  return lists.some((commits) => commits.some((commit) => commit.sha === sha)) ? { sha } : null;
}
