// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { unresolvedCoAuthorNames } from '../../domain/evaluation/index.ts';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';
import type { GitHubCommit, GitHubPullRequest } from '../ports/github.ts';

// The names a report shows (E09-S03), taken from what the `evaluate-pr` job fetched anyway: the pull request, its commits and
// their messages. Nothing is fetched for them and nothing is stored; they are handed to `EvaluationReporter.publish` and
// forgotten.

/** The login each account was seen under, by numeric id: the opener, then the author and committer of each commit. First seen wins. */
function seenLogins(pr: GitHubPullRequest, commits: readonly GitHubCommit[]): Map<number, string> {
  const logins = new Map<number, string>();
  for (const ref of [pr.opener, ...commits.flatMap((commit) => [commit.author, commit.committer])]) {
    if (ref !== null && !logins.has(ref.id)) {
      logins.set(ref.id, ref.login);
    }
  }
  return logins;
}

/** The names of the unresolved co-author trailers, by lower-case commit SHA; a commit with none is not in the map. */
function seenCoAuthors(commits: readonly GitHubCommit[]): Map<string, readonly string[]> {
  const coAuthors = new Map<string, readonly string[]>();
  for (const commit of commits) {
    const names = unresolvedCoAuthorNames(commit.message);
    if (names.length > 0) {
      coAuthors.set(commit.sha.toLowerCase(), names);
    }
  }
  return coAuthors;
}

/** The lookup of one report: the logins of the accounts the job saw and the names of the trailers it could not resolve. */
export function displayNamesOf(pr: GitHubPullRequest, commits: readonly GitHubCommit[]): DisplayNames {
  return { logins: seenLogins(pr, commits), coAuthors: seenCoAuthors(commits) };
}
