// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Account, CommitFacts } from '../../domain/evaluation/index.ts';
import type { GitHubAccountRef, GitHubCommit } from '../ports/github.ts';

// A commit as GitHub's client hands it over becomes the commit the engine takes (E07-S04): numeric ids and types, no login.

/** An account as the engine sees it: the numeric id and the type, no login. */
const accountOf = (ref: GitHubAccountRef | null): Account | null =>
  ref === null ? null : { id: ref.id, type: ref.type };

/** A commit as the engine takes it: the identities are numeric ids and types, the raw identities are display-only. */
export function commitFacts(commit: GitHubCommit): CommitFacts {
  return {
    sha: commit.sha,
    parents: commit.parents,
    author: accountOf(commit.author),
    committer: accountOf(commit.committer),
    message: commit.message,
    rawAuthor: commit.rawAuthor,
    rawCommitter: commit.rawCommitter,
  };
}
