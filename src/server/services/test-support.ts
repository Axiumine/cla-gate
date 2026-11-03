// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { AuditEntry } from './audit-entry.ts';
import {
  abortable,
  COMMIT_SHA,
  commentKey,
  commitKey,
  type FakeInstallation,
  FakeWorld,
  type GitHubMethod,
  membershipKey,
  mergeKey,
  openPullsPage,
  pageOf,
  permissionKey,
  pullKey,
  type RecordedCall,
  repositoryKey,
  takeFirst,
} from './fake-github/test-support.ts';

export type { GitHubMethod, RecordedCall };

import type { Clock } from './ports/clock.ts';
import type {
  GitHubAppInfo,
  GitHubClient,
  GitHubCommitPage,
  GitHubInstallation,
  GitHubIssueComment,
  GitHubOrgMembership,
  GitHubPullRequest,
  GitHubPullRequestPage,
  GitHubPullRequestRef,
  GitHubRepository,
  GitHubRepositoryPermission,
} from './ports/github.ts';
import {
  GitHubNotFoundError,
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
  type NotAdmittedReason,
} from './ports/github-errors.ts';
import type { InstallationGate } from './ports/installation-gate.ts';

/** A person acting; the numeric GitHub id, never a `users.id`. */
export const ACTOR = parseGithubId(41_898_282);

const anything = z.custom<AuditEntry>();

/**
 * Hands `value` to code that expects an {@link AuditEntry} without the type system's blessing: the way a caller written
 * in plain JavaScript, or a value that came from outside, could reach the writer. Tests only.
 */
export const unchecked = (value: unknown): AuditEntry => anything.parse(value);

/** A valid entry of a tenant action; override single fields to break it. */
export function tenantEntry(installationId: number, overrides: Partial<AuditEntry> = {}): AuditEntry {
  return { action: 'repository.enabled', installationId, actorGithubId: ACTOR, ...overrides };
}

/** A clock that stands still until a test moves it (E05-S02). */
export class FakeClock implements Clock {
  #milliseconds: number;

  constructor(start: string) {
    this.#milliseconds = Date.parse(start);
  }

  now(): Date {
    return new Date(this.#milliseconds);
  }

  advance(milliseconds: number): void {
    this.#milliseconds += milliseconds;
  }
}

/** A gate that admits every installation except those a test turns away, and keeps the ids it was asked about (E05-S03). */
export class FakeGate implements InstallationGate {
  readonly #refused = new Map<GithubId, NotAdmittedReason>();
  /** Every id the gate was asked about, in order. */
  readonly asked: GithubId[] = [];

  refuse(githubInstallationId: GithubId, reason: NotAdmittedReason): void {
    this.#refused.set(githubInstallationId, reason);
  }

  admit(githubInstallationId: GithubId): void {
    this.#refused.delete(githubInstallationId);
  }

  assertAdmitted(githubInstallationId: GithubId): Promise<void> {
    this.asked.push(githubInstallationId);
    const reason = this.#refused.get(githubInstallationId);
    return reason === undefined ? Promise.resolve() : Promise.reject(new InstallationNotAdmittedError(reason));
  }
}

/**
 * The GitHub client port in memory (E05-S04). A test scripts installations, repositories and memberships, runs the code
 * under test, and reads {@link FakeGitHub.calls}: every call served, with its method and installation id. Behaves like
 * the Octokit adapter at its edges: a missing installation or repository is null where the port says so; an
 * installation-level method throws InstallationGoneError for an installation GitHub does not have and
 * InstallationSuspendedError for a suspended one (the token provider's answers); and with a gate, a refused
 * installation throws InstallationNotAdmittedError before the call is recorded (the adapter's token request would never
 * be sent). The same contract suite runs against this and against the adapter.
 */
export class FakeGitHub extends FakeWorld implements GitHubClient {
  readonly #gate: InstallationGate | undefined;
  #signal: AbortSignal | undefined;

  constructor(options: { gate?: InstallationGate } = {}) {
    super();
    this.#gate = options.gate;
  }

  /** Every call served, in order. A call the gate refused is not here. */
  get calls(): RecordedCall[] {
    return this.state.calls;
  }

  /**
   * A view of this fake for one unit of work (E07-S03): it serves from the same world and records into the same
   * {@link FakeGitHub.calls}, and with `signal` aborted a call rejects with the reason of the signal, whether it was made
   * after the abort (nothing is recorded) or is waiting for a {@link FakeGitHub.beforeNext} hook.
   */
  withSignal(signal: AbortSignal): GitHubClient {
    const view = new FakeGitHub(this.#gate === undefined ? {} : { gate: this.#gate });
    view.state = this.state;
    view.#signal = signal;
    return view;
  }

  getApp(): Promise<GitHubAppInfo> {
    return this.#serve('getApp', undefined, () => this.state.app);
  }

  getInstallation(githubInstallationId: GithubId): Promise<GitHubInstallation | null> {
    return this.#serve(
      'getInstallation',
      githubInstallationId,
      () => this.state.installations.get(githubInstallationId)?.installation ?? null,
    );
  }

  listInstallations(): Promise<GitHubInstallation[]> {
    return this.#serve('listInstallations', undefined, () =>
      [...this.state.installations.values()].map((entry) => entry.installation),
    );
  }

  listInstallationRepositories(githubInstallationId: GithubId): Promise<GitHubRepository[]> {
    return this.#serveInstallation('listInstallationRepositories', githubInstallationId, (entry) => [
      ...entry.repositories,
    ]);
  }

  getRepositoryById(githubInstallationId: GithubId, githubRepoId: GithubId): Promise<GitHubRepository | null> {
    return this.#serveInstallation(
      'getRepositoryById',
      githubInstallationId,
      (entry) => entry.repositories.find((repository) => repository.id === githubRepoId) ?? null,
    );
  }

  getOrgMembership(githubInstallationId: GithubId, org: string, login: string): Promise<GitHubOrgMembership | null> {
    return this.#serveInstallation(
      'getOrgMembership',
      githubInstallationId,
      () => this.state.memberships.get(membershipKey(githubInstallationId, org, login)) ?? null,
    );
  }

  getRepositoryPermission(
    githubInstallationId: GithubId,
    owner: string,
    repo: string,
    login: string,
  ): Promise<GitHubRepositoryPermission | null> {
    return this.#serveInstallation(
      'getRepositoryPermission',
      githubInstallationId,
      () => this.state.permissions.get(permissionKey(githubInstallationId, `${owner}/${repo}`, login)) ?? null,
    );
  }

  getPullRequest(
    githubInstallationId: GithubId,
    fullName: string,
    prNumber: number,
  ): Promise<GitHubPullRequest | null> {
    return this.#serveInstallation(
      'getPullRequest',
      githubInstallationId,
      () => this.state.pullRequests.get(pullKey(githubInstallationId, fullName, prNumber)) ?? null,
    );
  }

  listOpenPullRequests(id: GithubId, name: string, page: number): Promise<GitHubPullRequestPage> {
    return this.#serveInstallation('listOpenPullRequests', id, (e) => openPullsPage(this.state, e, name, page));
  }

  listPullRequestCommits(
    githubInstallationId: GithubId,
    fullName: string,
    prNumber: number,
    page: number,
  ): Promise<GitHubCommitPage> {
    return this.#serveInstallation('listPullRequestCommits', githubInstallationId, () =>
      pageOf(
        this.state.pullCommits.get(pullKey(githubInstallationId, fullName, prNumber)),
        page,
        'GET /repos/{owner}/{repo}/pulls/{pull_number}/commits',
      ),
    );
  }

  listRepositoryCommits(
    githubInstallationId: GithubId,
    fullName: string,
    headSha: string,
    page: number,
  ): Promise<GitHubCommitPage> {
    return this.#serveInstallation('listRepositoryCommits', githubInstallationId, () =>
      pageOf(
        COMMIT_SHA.test(headSha)
          ? this.state.repositoryCommits.get(repositoryKey(githubInstallationId, fullName))
          : undefined,
        page,
        'GET /repos/{owner}/{repo}/commits',
      ),
    );
  }

  compareCommits(
    githubInstallationId: GithubId,
    fullName: string,
    baseSha: string,
    headSha: string,
  ): Promise<{ readonly mergeBaseSha: string }> {
    return this.#serveInstallation('compareCommits', githubInstallationId, () => {
      const key = mergeKey(githubInstallationId, fullName, { baseSha, headSha });
      const mergeBaseSha =
        COMMIT_SHA.test(baseSha) && COMMIT_SHA.test(headSha) ? this.state.mergeBases.get(key) : undefined;
      if (mergeBaseSha === undefined) {
        throw new GitHubNotFoundError('GET /repos/{owner}/{repo}/compare/{basehead}');
      }
      return { mergeBaseSha };
    });
  }

  getIssueComment(
    githubInstallationId: GithubId,
    fullName: string,
    commentId: GithubId,
  ): Promise<GitHubIssueComment | null> {
    return this.#serveInstallation(
      'getIssueComment',
      githubInstallationId,
      () => this.state.comments.get(commentKey(githubInstallationId, fullName, commentId)) ?? null,
    );
  }

  listPullRequestsForCommit(
    githubInstallationId: GithubId,
    fullName: string,
    headSha: string,
  ): Promise<GitHubPullRequestRef[]> {
    return this.#serveInstallation('listPullRequestsForCommit', githubInstallationId, () => [
      ...(COMMIT_SHA.test(headSha)
        ? (this.state.commitPulls.get(commitKey(githubInstallationId, fullName, headSha)) ?? [])
        : []),
    ]);
  }

  /**
   * Records the call, runs a scripted hook, then rejects with a scripted failure or answers with `read()` (which may
   * throw: that rejects too). A view with an aborted signal rejects with its reason before the call is recorded, and
   * while the hook is awaited.
   */
  async #serve<T>(method: GitHubMethod, installationId: GithubId | undefined, read: () => T): Promise<T> {
    const signal = this.#signal;
    signal?.throwIfAborted();
    const { calls, hooks, failures, observers } = this.state;
    const call: RecordedCall = { method, installationId };
    calls.push(call);
    for (const observer of observers) {
      observer(call);
    }
    const hook = takeFirst(hooks, method);
    const scripted = takeFirst(failures, method);
    await abortable(signal, hook?.run() ?? Promise.resolve());
    if (scripted !== undefined) {
      throw scripted.error;
    }
    return read();
  }

  /** {@link FakeGitHub.#serve} for a method that acts with the installation's token: the gate and the token's answers first. */
  async #serveInstallation<T>(
    method: GitHubMethod,
    githubInstallationId: GithubId,
    read: (entry: FakeInstallation) => T,
  ): Promise<T> {
    this.#signal?.throwIfAborted();
    await (this.#gate ?? OPEN_GATE).assertAdmitted(githubInstallationId);
    return this.#serve(method, githubInstallationId, () => {
      const entry = this.state.installations.get(githubInstallationId);
      if (entry === undefined) {
        throw new InstallationGoneError(githubInstallationId);
      }
      if (entry.installation.suspendedAt !== null) {
        throw new InstallationSuspendedError(githubInstallationId);
      }
      return read(entry);
    });
  }
}

const OPEN_GATE: InstallationGate = { assertAdmitted: () => Promise.resolve() };
