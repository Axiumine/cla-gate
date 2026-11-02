// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';

// The only door to GitHub for the services (E05-S04). The domain and src/shared never import it. The Octokit adapter
// (src/server/adapters/github) implements it for production and `FakeGitHub` (src/server/services/test-support.ts) in
// memory; both run the same contract suite.
//
// Extension rule: a later epic adds a method here together with its own zod schema in the adapter, its row in the
// fake and its case in the contract suite. No method returns a raw Octokit response: a method returns the fields the
// platform uses, in the types below.
//
// What a method throws is in `./github-errors.ts`: 401 is GitHubAuthError, 404 GitHubNotFoundError (unless the method
// resolves null for it), another 403 GitHubForbiddenError, a 5xx or a network failure GitHubUnavailableError, a rate
// limit that is too long to wait out (or that came back after two waits) GitHubRateLimitedError, an answer that is not
// what the schema says GitHubResponseError, and an installation the instance does not serve
// InstallationNotAdmittedError (installation-level methods only, before any request).

/** The account types an App can be owned by. */
type GitHubAccountType = 'User' | 'Organization';

/**
 * The account types an installation can belong to: a user, an organisation or `Other`, which is any account GitHub
 * describes in another way (an enterprise). `Other` is read, recorded as rejected and never served.
 */
type GitHubInstallationAccountType = GitHubAccountType | 'Other';

/** The App the JWT belongs to (`GET /app`). */
export interface GitHubAppInfo {
  readonly id: GithubId;
  readonly slug: string;
  /** The account that owns the App. */
  readonly owner: { readonly id: GithubId; readonly type: GitHubAccountType };
  /** Permission name to level, for example `checks` to `write`. */
  readonly permissions: Readonly<Record<string, string>>;
}

/** One installation of the App. The login is a display snapshot; the numeric ids are the identity. */
export interface GitHubInstallation {
  /** The installation id: the tenant key. */
  readonly id: GithubId;
  readonly account: {
    readonly id: GithubId;
    readonly login: string;
    readonly type: GitHubInstallationAccountType;
  };
  /** When GitHub suspended the installation; null while it is active. */
  readonly suspendedAt: Date | null;
  readonly permissions: Readonly<Record<string, string>>;
}

/** A repository the installation can reach. The name is a display snapshot; the numeric id is the identity. */
export interface GitHubRepository {
  readonly id: GithubId;
  /** `owner/name`. */
  readonly fullName: string;
}

/** A person's membership of an organisation (`GET /orgs/{org}/memberships/{username}`). */
export interface GitHubOrgMembership {
  /** `pending` is an invitation that was not accepted yet. */
  readonly state: 'active' | 'pending';
  readonly role: 'admin' | 'member' | 'billing_manager';
  /** The member's numeric GitHub id. */
  readonly userId: GithubId;
}

/**
 * A person's permission on one repository (`GET /repos/{owner}/{repo}/collaborators/{username}/permission`). `permission`
 * is the base level GitHub reports: a custom role maps onto one of these, so `role_name` is never read. Only `admin`
 * makes someone a repository admin (E11-S03).
 */
export interface GitHubRepositoryPermission {
  readonly permission: 'admin' | 'maintain' | 'write' | 'triage' | 'read' | 'none';
  /** The numeric GitHub id of the person the answer is about: the identity the caller compares with its own. */
  readonly userId: GithubId;
}

/** The account types GitHub gives an account that opens a pull request or commits: no `Unknown`, which is for trailers only. */
type GitHubCommitAccountType = 'User' | 'Bot' | 'Organization' | 'Mannequin';

/**
 * An account of a pull request or a commit (E07-S10). The numeric id is the identity; the login is a lookup handle (the
 * organisation membership call takes one) and a display snapshot, and never reaches the evaluation engine.
 */
export interface GitHubAccountRef {
  readonly id: GithubId;
  readonly login: string;
  readonly type: GitHubCommitAccountType;
}

/**
 * The kinds of account that can write a comment: the types of {@link GitHubCommitAccountType}, and `Other` for any type
 * GitHub names that the platform has no word for (an enterprise). Only `Bot` is ever treated differently.
 */
type GitHubCommentAuthorType = GitHubCommitAccountType | 'Other';

/**
 * A comment on an issue or a pull request (`GET /repos/{owner}/{repo}/issues/comments/{comment_id}`, E07-S07). A
 * pull request's conversation is its issue's, so the same comment shape serves both. The text is what somebody typed: it is
 * only ever compared with the command, never stored or logged.
 */
export interface GitHubIssueComment {
  readonly id: GithubId;
  /** The number of the issue or pull request the comment is on, read from the comment's `issue_url`. */
  readonly issueNumber: number;
  readonly body: string;
  /** The account that wrote it, or null when GitHub shows none. The numeric id is the identity; there is no login. */
  readonly author: { readonly id: GithubId; readonly type: GitHubCommentAuthorType } | null;
}

/** A pull request as a listing names it (E07-S07): enough to tell whether a commit is the head of an open one. */
export interface GitHubPullRequestRef {
  readonly number: number;
  readonly state: 'open' | 'closed';
  /** Lower-case commit SHA of the head. */
  readonly headSha: string;
}

/** A pull request as the evaluation reads it (`GET /repos/{owner}/{repo}/pulls/{pull_number}`). */
export interface GitHubPullRequest {
  readonly number: number;
  readonly state: 'open' | 'closed';
  readonly draft: boolean;
  /** Lower-case commit SHA of the head. */
  readonly headSha: string;
  /** Lower-case commit SHA of the base branch tip. */
  readonly baseSha: string;
  /** The account that opened the pull request. */
  readonly opener: GitHubAccountRef;
  /** How many commits GitHub says the pull request has. */
  readonly commitCount: number;
}

/**
 * One commit of a listing. `author` and `committer` are the GitHub accounts git's identities are linked to, or `null`
 * when GitHub could not link them (the answer holds `null`, `{}`, or no numeric id): an unlinked identity. The raw
 * identities are what git recorded; they are display-only. SHAs are lower case.
 */
export interface GitHubCommit {
  readonly sha: string;
  readonly parents: readonly string[];
  readonly author: GitHubAccountRef | null;
  readonly committer: GitHubAccountRef | null;
  readonly message: string;
  readonly rawAuthor: { readonly name: string; readonly email: string };
  readonly rawCommitter: { readonly name: string; readonly email: string };
}

/** One page of a listing of open pull requests (E07-S08), 100 at most, newest first. `last` is true when GitHub names no next page. */
export interface GitHubPullRequestPage {
  readonly pulls: readonly GitHubPullRequestRef[];
  readonly last: boolean;
}

/** One page of a commit listing, 100 commits at most. `last` is true when GitHub names no next page. */
export interface GitHubCommitPage {
  readonly commits: readonly GitHubCommit[];
  readonly last: boolean;
}

export interface GitHubClient {
  /** `GET /app`, signed as the App. */
  getApp(): Promise<GitHubAppInfo>;

  /** `GET /app/installations/{id}`, signed as the App. Resolves null when the installation does not exist (404). */
  getInstallation(githubInstallationId: GithubId): Promise<GitHubInstallation | null>;

  /**
   * `GET /app/installations?per_page=100`, signed as the App: every installation of the App, all pages.
   * @throws GitHubResponseError `pagination_limit` past 100 pages: a truncated list is never returned.
   */
  listInstallations(): Promise<GitHubInstallation[]>;

  /**
   * `GET /installation/repositories?per_page=100` with the installation's token: every repository it can reach, all
   * pages.
   * @throws GitHubResponseError `pagination_limit` past 100 pages: a truncated list would mark repositories removed.
   */
  listInstallationRepositories(githubInstallationId: GithubId): Promise<GitHubRepository[]>;

  /**
   * `GET /repositories/{id}` with the installation's token. Resolves null when the repository does not exist or the
   * installation cannot see it (404 or 403).
   */
  getRepositoryById(githubInstallationId: GithubId, githubRepoId: GithubId): Promise<GitHubRepository | null>;

  /**
   * `GET /orgs/{org}/memberships/{username}` with the installation's token (Members: read). Resolves null when there
   * is no such membership (404) and for a name GitHub cannot hold (no request is sent for it; the installation is
   * checked first all the same). This is the one membership call:
   * the exemption lookup (E07-S10) and the admin role (E11-S02) both use it.
   */
  getOrgMembership(githubInstallationId: GithubId, org: string, login: string): Promise<GitHubOrgMembership | null>;

  /**
   * `GET /repos/{owner}/{repo}/collaborators/{username}/permission` with the installation's token (Metadata: read).
   * Resolves null when GitHub has no such repository for this installation or no such person (404) and for a name
   * GitHub cannot hold (no request is sent for it; the installation is checked first all the same). The repository
   * admin role (E11-S03) reads it.
   */
  getRepositoryPermission(
    githubInstallationId: GithubId,
    owner: string,
    repo: string,
    login: string,
  ): Promise<GitHubRepositoryPermission | null>;

  /**
   * `GET /repos/{owner}/{repo}/pulls/{pull_number}` with the installation's token (E07-S10). `fullName` is `owner/name`
   * as GitHub shows it now. Resolves null for a pull request GitHub does not have, and for a name GitHub cannot hold.
   */
  getPullRequest(githubInstallationId: GithubId, fullName: string, prNumber: number): Promise<GitHubPullRequest | null>;

  /**
   * `GET /repos/{owner}/{repo}/issues/comments/{comment_id}` with the installation's token (E07-S07). Resolves null for a
   * comment GitHub does not have (deleted), and for a name GitHub cannot hold.
   */
  getIssueComment(
    githubInstallationId: GithubId,
    fullName: string,
    commentId: GithubId,
  ): Promise<GitHubIssueComment | null>;

  /**
   * `GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls?per_page=100` with the installation's token (E07-S07): the pull
   * requests GitHub associates with a commit, open or closed, whatever repository their head is in (a fork's included),
   * the first 100 of them. Resolves an empty list for a commit or repository GitHub does not have and for a name or SHA
   * GitHub cannot hold.
   */
  listPullRequestsForCommit(
    githubInstallationId: GithubId,
    fullName: string,
    headSha: string,
  ): Promise<GitHubPullRequestRef[]>;

  /**
   * One page (1-based, 100 pull requests) of `GET /repos/{owner}/{repo}/pulls?state=open` with the installation's token
   * (E07-S08): the open pull requests of a repository, newest first, each with its number, state and head SHA. The sweep
   * reads at most ten pages of a repository per run.
   * @throws GitHubNotFoundError for a repository GitHub does not have, one the installation does not reach and a name GitHub
   * cannot hold; GitHubForbiddenError when GitHub refuses the read (a blocked repository).
   */
  listOpenPullRequests(githubInstallationId: GithubId, fullName: string, page: number): Promise<GitHubPullRequestPage>;

  /**
   * One page (1-based, 100 commits) of `GET /repos/{owner}/{repo}/pulls/{pull_number}/commits`: the commits of the pull
   * request in GitHub's order, at most 250 of them in all.
   * @throws GitHubNotFoundError for a pull request GitHub does not have.
   */
  listPullRequestCommits(
    githubInstallationId: GithubId,
    fullName: string,
    prNumber: number,
    page: number,
  ): Promise<GitHubCommitPage>;

  /**
   * One page (1-based, 100 commits) of `GET /repos/{owner}/{repo}/commits?sha={headSha}`: the history behind `headSha`
   * in commit-date order, which is how a pull request above 250 commits is read (E08-S07).
   * @throws GitHubNotFoundError for a repository or commit GitHub does not have.
   */
  listRepositoryCommits(
    githubInstallationId: GithubId,
    fullName: string,
    headSha: string,
    page: number,
  ): Promise<GitHubCommitPage>;

  /**
   * `GET /repos/{owner}/{repo}/compare/{base}...{head}`: the merge base of the two commits (a criss-cross history
   * has several; GitHub names one).
   * @throws GitHubNotFoundError for a repository or commit GitHub does not have.
   */
  compareCommits(
    githubInstallationId: GithubId,
    fullName: string,
    baseSha: string,
    headSha: string,
  ): Promise<{ readonly mergeBaseSha: string }>;

  /**
   * The same client for one unit of work, such as a job (E07-S03): a request is abandoned, and rejects with the reason of
   * `signal`, when `signal` aborts, and one made after it aborted is not sent. The rate limits, the installation tokens
   * and the gate are those of this client, so a view is as cheap as an object. The signal reaches the requests of the
   * methods above; the token an installation needs is minted under its own timeout.
   */
  withSignal(signal: AbortSignal): GitHubClient;
}
