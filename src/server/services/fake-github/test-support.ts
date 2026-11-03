// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import { CheckRunStore } from '../fake-check-runs/test-support.ts';
import { CommentIds, commentsOfIssue, pageOfComments, postedComment } from '../fake-comments/test-support.ts';
import type {
  GitHubAppInfo,
  GitHubCheckRun,
  GitHubCommit,
  GitHubCommitPage,
  GitHubInstallation,
  GitHubIssueComment,
  GitHubIssueCommentPage,
  GitHubOrgMembership,
  GitHubPullRequest,
  GitHubPullRequestPage,
  GitHubPullRequestRef,
  GitHubRepository,
  GitHubRepositoryPermission,
} from '../ports/github.ts';
import { GitHubNotFoundError } from '../ports/github-errors.ts';

// What `FakeGitHub` (../test-support.ts) is built from, kept apart so that neither file outgrows the caps: waiting for a
// signal, taking a scripted entry, paging a listing as GitHub does, and the keys of the world's maps.

/** The App a fresh `FakeGitHub` is. */
const FAKE_APP: GitHubAppInfo = {
  id: parseGithubId(4242),
  slug: 'cla-gate-test',
  owner: { id: parseGithubId(9001), type: 'Organization' },
  permissions: { checks: 'write', metadata: 'read', pull_requests: 'read' },
};

/**
 * What `work` returns, or a rejection with the reason of `signal` as soon as it aborts, whichever comes first. `work` starts
 * at once, aborted or not; it is a function so that the promise it makes is returned, never left dangling.
 */
export function abortable<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
  if (signal === undefined) {
    return work();
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      try {
        signal.throwIfAborted();
      } catch (reason) {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the reason of a signal is whatever the aborter passed, and the caller must get exactly that
        reject(reason);
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    work()
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
  });
}

/** Removes and returns the first scripted entry for `method`, or undefined. */
export function takeFirst<T extends { readonly method: string }>(queue: T[], method: string): T | undefined {
  const index = queue.findIndex((entry) => entry.method === method);
  return index === -1 ? undefined : queue.splice(index, 1)[0];
}

/** A commit id GitHub can hold: the adapter sends nothing else in a path or a query, and so the fake knows nothing else. */
export const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Commits per page of a listing: the most GitHub gives. */
const COMMITS_PER_PAGE = 100;

/** Page `page` (1-based) of `commits`; a listing nobody scripted is a 404, as for a repository GitHub does not have. */
export function pageOf(commits: readonly GitHubCommit[] | undefined, page: number, route: string): GitHubCommitPage {
  if (commits === undefined) {
    throw new GitHubNotFoundError(route);
  }
  const from = (page - 1) * COMMITS_PER_PAGE;
  return { commits: commits.slice(from, from + COMMITS_PER_PAGE), last: from + COMMITS_PER_PAGE >= commits.length };
}

/** Page `page` (1-based, 100) of the open pull requests of `fullName` among `pulls`, newest (highest number) first, as `GET .../pulls?state=open` lists them. */
function openPage(pulls: readonly GitHubPullRequest[], page: number): GitHubPullRequestPage {
  const open = pulls
    .filter((pull) => pull.state === 'open')
    .toSorted((a, b) => b.number - a.number)
    .map(({ number, state, headSha }) => ({ number, state, headSha }));
  const from = (page - 1) * COMMITS_PER_PAGE;
  return { pulls: open.slice(from, from + COMMITS_PER_PAGE), last: from + COMMITS_PER_PAGE >= open.length };
}

/**
 * The listing of the open pull requests of `fullName` in the world, for the installation `entry` stands for (E07-S08): a
 * repository the installation does not reach is a 404, as it is for GitHub. Names are compared without regard to case.
 */
export function openPullsPage(
  state: { readonly pullRequests: ReadonlyMap<string, GitHubPullRequest> },
  entry: { readonly installation: { readonly id: GithubId }; readonly repositories: readonly GitHubRepository[] },
  fullName: string,
  page: number,
): GitHubPullRequestPage {
  if (!entry.repositories.some((repository) => repository.fullName.toLowerCase() === fullName.toLowerCase())) {
    throw new GitHubNotFoundError('GET /repos/{owner}/{repo}/pulls');
  }
  const prefix = `${repositoryKey(entry.installation.id, fullName)}#`;
  return openPage(
    [...state.pullRequests].filter(([key]) => key.startsWith(prefix)).map(([, pull]) => pull),
    page,
  );
}

/**
 * A write to a repository the installation reaches, with SHAs GitHub can hold (E09-S05): the adapter sends nothing else to
 * a path, and a repository the installation does not reach is a 404, as it is for GitHub. Names compare without regard to case.
 * @throws GitHubNotFoundError naming `route`.
 */
export function reachable(
  entry: FakeInstallation,
  fullName: string,
  route: string,
  shas: readonly string[] = [],
): void {
  const known = entry.repositories.some((repository) => repository.fullName.toLowerCase() === fullName.toLowerCase());
  if (!(known && shas.every((sha) => COMMIT_SHA.test(sha)))) {
    throw new GitHubNotFoundError(route);
  }
}

/** GitHub compares repository names without regard to case too. */
export const repositoryKey = (githubInstallationId: GithubId, fullName: string): string =>
  `${githubInstallationId}/${fullName.toLowerCase()}`;

export const pullKey = (githubInstallationId: GithubId, fullName: string, prNumber: number): string =>
  `${repositoryKey(githubInstallationId, fullName)}#${prNumber}`;

const mergeKey = (
  githubInstallationId: GithubId,
  fullName: string,
  { baseSha, headSha }: { readonly baseSha: string; readonly headSha: string },
): string => `${repositoryKey(githubInstallationId, fullName)}@${baseSha}...${headSha}`;

/** The part of a comment key that names its repository: what `commentKey` adds the id to. */
const commentPrefix = (githubInstallationId: GithubId, fullName: string): string =>
  `${repositoryKey(githubInstallationId, fullName)}/comments/`;

export const commentKey = (githubInstallationId: GithubId, fullName: string, commentId: GithubId): string =>
  `${commentPrefix(githubInstallationId, fullName)}${commentId}`;

export const commitKey = (githubInstallationId: GithubId, fullName: string, headSha: string): string =>
  `${repositoryKey(githubInstallationId, fullName)}/commits/${headSha}`;

/** GitHub compares organisation and login names without regard to case. */
export const membershipKey = (githubInstallationId: GithubId, org: string, login: string): string =>
  `${githubInstallationId}/${org.toLowerCase()}/${login.toLowerCase()}`;

/** GitHub compares repository and login names without regard to case. */
export const permissionKey = (githubInstallationId: GithubId, fullName: string, login: string): string =>
  `${githubInstallationId}/${fullName.toLowerCase()}/${login.toLowerCase()}`;

/** The methods of the GitHub client port, as the recorder of {@link FakeGitHub} names them. */
export type GitHubMethod =
  | 'getApp'
  | 'getInstallation'
  | 'listInstallations'
  | 'listInstallationRepositories'
  | 'getRepositoryById'
  | 'getOrgMembership'
  | 'getRepositoryPermission'
  | 'getPullRequest'
  | 'listPullRequestCommits'
  | 'listRepositoryCommits'
  | 'compareCommits'
  | 'getIssueComment'
  | 'updateIssueComment'
  | 'listIssueComments'
  | 'createIssueComment'
  | 'listPullRequestsForCommit'
  | 'listOpenPullRequests'
  | 'createCheckRun'
  | 'updateCheckRun'
  | 'getCheckRun'
  | 'listCheckRunsForRef';

/** One call the fake served: the method and the installation id it was made for (undefined: not about one). */
export interface RecordedCall {
  readonly method: GitHubMethod;
  readonly installationId: GithubId | undefined;
}

/** What the fake knows of one installation. */
export interface FakeInstallation {
  installation: GitHubInstallation;
  repositories: GitHubRepository[];
}

/** The world of a {@link FakeGitHub}, shared by the fake and its views. */
export interface FakeState {
  readonly calls: RecordedCall[];
  readonly installations: Map<GithubId, FakeInstallation>;
  readonly memberships: Map<string, GitHubOrgMembership>;
  readonly permissions: Map<string, GitHubRepositoryPermission>;
  readonly pullRequests: Map<string, GitHubPullRequest>;
  readonly pullCommits: Map<string, readonly GitHubCommit[]>;
  readonly repositoryCommits: Map<string, readonly GitHubCommit[]>;
  readonly mergeBases: Map<string, string>;
  readonly comments: Map<string, GitHubIssueComment>;
  /** The ids the comments the world posts get (E09-S07). */
  readonly commentIds: CommentIds;
  readonly commitPulls: Map<string, readonly GitHubPullRequestRef[]>;
  readonly checkRuns: CheckRunStore;
  readonly observers: ((call: RecordedCall) => void)[];
  readonly failures: { method: GitHubMethod; error: Error }[];
  readonly hooks: { method: GitHubMethod; run: () => Promise<void> }[];
  app: GitHubAppInfo;
}

/** A world that holds the App and nothing else. */
function freshState(): FakeState {
  return {
    calls: [],
    installations: new Map(),
    memberships: new Map(),
    permissions: new Map(),
    pullRequests: new Map(),
    pullCommits: new Map(),
    repositoryCommits: new Map(),
    mergeBases: new Map(),
    comments: new Map(),
    commentIds: new CommentIds(),
    commitPulls: new Map(),
    checkRuns: new CheckRunStore(),
    observers: [],
    failures: [],
    hooks: [],
    app: FAKE_APP,
  };
}

/**
 * The scripting half of {@link FakeGitHub} (E05-S04): what a test puts in the world, and the failures and hooks it queues.
 * The world is shared by a fake and the views made from it (`FakeGitHub.withSignal`).
 */
export class FakeWorld {
  protected state: FakeState = freshState();

  setApp(app: GitHubAppInfo): void {
    this.state.app = app;
  }

  /** Adds, or replaces, an installation with the repositories it can reach. */
  addInstallation(installation: GitHubInstallation, repositories: readonly GitHubRepository[] = []): void {
    this.state.installations.set(installation.id, { installation, repositories: [...repositories] });
  }

  /** Replaces the repositories an installation can reach. @throws Error for an installation never added. */
  setRepositories(githubInstallationId: GithubId, repositories: readonly GitHubRepository[]): void {
    this.known(githubInstallationId).repositories = [...repositories];
  }

  /** Suspends the installation at `at`, or lifts the suspension with null. @throws Error for an unknown installation. */
  suspend(githubInstallationId: GithubId, at: Date | null): void {
    const entry = this.known(githubInstallationId);
    entry.installation = { ...entry.installation, suspendedAt: at };
  }

  /** The installation is gone from GitHub (uninstalled). */
  removeInstallation(githubInstallationId: GithubId): void {
    this.state.installations.delete(githubInstallationId);
  }

  addMembership(githubInstallationId: GithubId, org: string, login: string, membership: GitHubOrgMembership): void {
    this.state.memberships.set(membershipKey(githubInstallationId, org, login), membership);
  }

  /** Scripts what `GET /repos/{owner}/{repo}/collaborators/{username}/permission` answers to `login` for `fullName` (`owner/name`). */
  addRepositoryPermission(
    githubInstallationId: GithubId,
    fullName: string,
    login: string,
    permission: GitHubRepositoryPermission,
  ): void {
    this.state.permissions.set(permissionKey(githubInstallationId, fullName, login), permission);
  }

  /** Adds, or replaces, a pull request of a repository (`owner/name`) of an installation. */
  addPullRequest(githubInstallationId: GithubId, fullName: string, pullRequest: GitHubPullRequest): void {
    this.state.pullRequests.set(pullKey(githubInstallationId, fullName, pullRequest.number), pullRequest);
  }

  /** The commits `GET .../pulls/{n}/commits` lists for a pull request, in order (at most 250 on GitHub). */
  setPullRequestCommits(
    githubInstallationId: GithubId,
    fullName: string,
    prNumber: number,
    commits: readonly GitHubCommit[],
  ): void {
    this.state.pullCommits.set(pullKey(githubInstallationId, fullName, prNumber), commits);
  }

  /** The history `GET .../commits?sha=` lists for a repository, in the order given (commit-date order on GitHub). */
  setRepositoryCommits(githubInstallationId: GithubId, fullName: string, commits: readonly GitHubCommit[]): void {
    this.state.repositoryCommits.set(repositoryKey(githubInstallationId, fullName), commits);
  }

  /** The merge base `compareCommits` answers for two commits of a repository. */
  setMergeBase(
    githubInstallationId: GithubId,
    fullName: string,
    commits: { readonly baseSha: string; readonly headSha: string },
    mergeBaseSha: string,
  ): void {
    this.state.mergeBases.set(mergeKey(githubInstallationId, fullName, commits), mergeBaseSha);
  }

  /** Adds, or replaces, a comment of a repository (`owner/name`) of an installation. */
  addIssueComment(githubInstallationId: GithubId, fullName: string, comment: GitHubIssueComment): void {
    this.state.comments.set(commentKey(githubInstallationId, fullName, comment.id), comment);
  }

  /** The pull requests `GET .../commits/{sha}/pulls` lists for a commit of a repository. */
  setCommitPullRequests(
    githubInstallationId: GithubId,
    fullName: string,
    headSha: string,
    pulls: readonly GitHubPullRequestRef[],
  ): void {
    this.state.commitPulls.set(commitKey(githubInstallationId, fullName, headSha), pulls);
  }

  /** Adds a Check Run that somebody else posted, or one of ours with an id a test chooses, to a repository (`owner/name`) of an installation. */
  addCheckRun(githubInstallationId: GithubId, fullName: string, run: GitHubCheckRun): void {
    this.state.checkRuns.seed({ installationId: githubInstallationId, fullName }, run);
  }

  /** `listener` is told of every call the fake serves, in order, as it is recorded: what a test uses to order GitHub's calls among other events. */
  observe(listener: (call: RecordedCall) => void): void {
    this.state.observers.push(listener);
  }

  /** The next call of `method` throws `error` (once, after it is recorded). Several calls queue in order. */
  failNext(method: GitHubMethod, error: Error): void {
    this.state.failures.push({ method, error });
  }

  /**
   * `run` is awaited once, just before the next call of `method` is answered (and after it is recorded): the world can
   * change while the caller waits for GitHub, as it does on the real network. Several hooks queue in order.
   */
  beforeNext(method: GitHubMethod, run: () => Promise<void>): void {
    this.state.hooks.push({ method, run });
  }

  protected known(githubInstallationId: GithubId): FakeInstallation {
    const entry = this.state.installations.get(githubInstallationId);
    if (entry === undefined) {
      throw new Error(`FakeGitHub has no installation ${githubInstallationId}: add it first`);
    }
    return entry;
  }
}

/** The merge base scripted for two commits of a repository. @throws GitHubNotFoundError for a pair nobody scripted, or a SHA GitHub cannot hold. */
export function mergeBaseOf(
  state: Pick<FakeState, 'mergeBases'>,
  githubInstallationId: GithubId,
  commits: { readonly fullName: string; readonly baseSha: string; readonly headSha: string },
): { readonly mergeBaseSha: string } {
  const { fullName, baseSha, headSha } = commits;
  const mergeBaseSha =
    COMMIT_SHA.test(baseSha) && COMMIT_SHA.test(headSha)
      ? state.mergeBases.get(mergeKey(githubInstallationId, fullName, { baseSha, headSha }))
      : undefined;
  if (mergeBaseSha === undefined) {
    throw new GitHubNotFoundError('GET /repos/{owner}/{repo}/compare/{basehead}');
  }
  return { mergeBaseSha };
}

/** What the comment calls of the fake read: the comments of the world, the ids it hands out and the App it posts as. */
type CommentWorld = Pick<FakeState, 'comments' | 'commentIds' | 'app'>;

/** Page `page` of the comments of the issue `issueNumber` of `fullName`, for the installation `entry` stands for (E09-S07). @throws GitHubNotFoundError for a repository it does not reach. */
export function commentsPage(
  world: CommentWorld,
  at: { readonly entry: FakeInstallation; readonly fullName: string; readonly issueNumber: number },
  page: number,
): GitHubIssueCommentPage {
  reachable(at.entry, at.fullName, 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments');
  const prefix = commentPrefix(at.entry.installation.id, at.fullName);
  return pageOfComments(commentsOfIssue(world.comments, prefix, at.issueNumber), page);
}

/** A comment posted by the App on the issue `issueNumber` of `fullName`, for the installation `entry` stands for (E09-S07). @throws GitHubNotFoundError for a repository it does not reach. */
export function postComment(
  world: CommentWorld,
  at: { readonly entry: FakeInstallation; readonly fullName: string; readonly issueNumber: number },
  body: string,
): GitHubIssueComment {
  reachable(at.entry, at.fullName, 'POST /repos/{owner}/{repo}/issues/{issue_number}/comments');
  const id = world.commentIds.take();
  const posted = postedComment({ id, issueNumber: at.issueNumber, appId: world.app.id }, body);
  world.comments.set(commentKey(at.entry.installation.id, at.fullName, id), posted);
  return posted;
}

/** The comment `commentId` of `fullName` rewritten to `body`, for the installation `entry` stands for (E09-S06). @throws GitHubNotFoundError for a comment or repository it does not have. */
export function rewriteComment(
  world: CommentWorld,
  at: { readonly entry: FakeInstallation; readonly fullName: string; readonly commentId: GithubId },
  body: string,
): GitHubIssueComment {
  const route = 'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}';
  reachable(at.entry, at.fullName, route);
  const key = commentKey(at.entry.installation.id, at.fullName, at.commentId);
  const comment = world.comments.get(key);
  if (comment === undefined) {
    throw new GitHubNotFoundError(route);
  }
  const rewritten = { ...comment, body };
  world.comments.set(key, rewritten);
  return rewritten;
}
