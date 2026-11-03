// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type {
  GitHubAccountRef,
  GitHubCommit,
  GitHubInstallation,
  GitHubIssueComment,
  GitHubPullRequest,
  GitHubPullRequestRef,
  GitHubRepository,
} from '../../../services/ports/github.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';

// The bodies the mocked GitHub of the HTTP world answers with (E05-S04, E07-S07, E07-S10): each entity of the port as GitHub
// spells it, with fields the platform does not use, so the schemas of the adapter are shown to keep only what they read.

/** An installation as GitHub spells it, with fields the platform does not use. */
export function installationBody(installation: GitHubInstallation): Record<string, unknown> {
  return {
    id: installation.id,
    account: { ...installation.account, node_id: 'MDEyOk9yZ2FuaXphdGlvbg==', site_admin: false },
    app_id: 4242,
    repository_selection: 'all',
    suspended_at: installation.suspendedAt === null ? null : installation.suspendedAt.toISOString(),
    suspended_by: null,
    permissions: installation.permissions,
    events: ['pull_request'],
  };
}

export function repositoryBody(repository: GitHubRepository): Record<string, unknown> {
  const [owner = 'unknown', name = 'unknown'] = repository.fullName.split('/');
  return {
    id: repository.id,
    name,
    full_name: repository.fullName,
    private: true,
    owner: { login: owner, id: 1, type: 'Organization' },
    default_branch: 'main',
  };
}

/** An account as GitHub spells it, with fields the platform does not use; `null` stays `null`, as for an unlinked identity. */
function accountBody(account: GitHubAccountRef | null): Record<string, unknown> | null {
  return account === null ? null : { ...account, node_id: 'MDQ6VXNlcjE=', site_admin: false };
}

export function pullRequestBody(pullRequest: GitHubPullRequest): Record<string, unknown> {
  return {
    number: pullRequest.number,
    state: pullRequest.state,
    draft: pullRequest.draft,
    head: { sha: pullRequest.headSha, ref: 'feature' },
    base: { sha: pullRequest.baseSha, ref: 'main' },
    user: accountBody(pullRequest.opener),
    commits: pullRequest.commitCount,
    title: 'A title the platform never reads',
  };
}

export function commitBody(commit: GitHubCommit): Record<string, unknown> {
  return {
    sha: commit.sha,
    parents: commit.parents.map((sha) => ({ sha })),
    author: accountBody(commit.author),
    committer: accountBody(commit.committer),
    commit: {
      message: commit.message,
      author: { ...commit.rawAuthor, date: '2026-11-01T09:00:00Z' },
      committer: { ...commit.rawCommitter, date: '2026-11-01T09:00:00Z' },
    },
  };
}

/** A comment as GitHub spells it: the issue it is on is named by a URL, and an account of a type the platform has no word for is an enterprise. */
export function commentBody(comment: GitHubIssueComment, repository: string): Record<string, unknown> {
  const { author } = comment;
  return {
    id: comment.id,
    body: comment.body,
    user:
      author === null
        ? null
        : {
            id: author.id,
            login: 'someone',
            type: author.type === 'Other' ? 'Enterprise' : author.type,
            site_admin: false,
          },
    issue_url: `${GITHUB_API_ORIGIN}/repos/${repository}/issues/${comment.issueNumber}`,
    html_url: 'https://github.com/x',
    performed_via_github_app:
      comment.appId === null ? null : { id: comment.appId, slug: 'cla-gate-test', name: 'CLA Gate Test' },
  };
}

/** A pull request of a listing (a commit's, or a repository's open ones), whose head lives in a fork: a listing does not care where the head is. */
export function pullRefBody(pull: GitHubPullRequestRef): Record<string, unknown> {
  return {
    number: pull.number,
    state: pull.state,
    head: { sha: pull.headSha, ref: 'feature', repo: { full_name: 'forker/api', fork: true } },
    base: { sha: 'b'.repeat(40), ref: 'main' },
    title: 'A title the platform never reads',
  };
}
