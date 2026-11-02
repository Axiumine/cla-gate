// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../shared/github-id.ts';
import type { AuditEntry } from './audit-entry.ts';
import type { Clock } from './ports/clock.ts';
import type {
  GitHubAppInfo,
  GitHubClient,
  GitHubInstallation,
  GitHubOrgMembership,
  GitHubRepository,
  GitHubRepositoryPermission,
} from './ports/github.ts';
import {
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

/** The methods of the GitHub client port, as the recorder of {@link FakeGitHub} names them. */
export type GitHubMethod =
  | 'getApp'
  | 'getInstallation'
  | 'listInstallations'
  | 'listInstallationRepositories'
  | 'getRepositoryById'
  | 'getOrgMembership'
  | 'getRepositoryPermission';

/** One call the fake served: the method and the installation id it was made for (undefined: not about one). */
export interface RecordedCall {
  readonly method: GitHubMethod;
  readonly installationId: GithubId | undefined;
}

/** What the fake knows of one installation. */
interface FakeInstallation {
  installation: GitHubInstallation;
  repositories: GitHubRepository[];
}

/** The App a fresh {@link FakeGitHub} is. */
const FAKE_APP: GitHubAppInfo = {
  id: parseGithubId(4242),
  slug: 'cla-gate-test',
  owner: { id: parseGithubId(9001), type: 'Organization' },
  permissions: { checks: 'write', metadata: 'read', pull_requests: 'read' },
};

/** The world of a {@link FakeGitHub}, shared by the fake and its views. */
interface FakeState {
  readonly calls: RecordedCall[];
  readonly installations: Map<GithubId, FakeInstallation>;
  readonly memberships: Map<string, GitHubOrgMembership>;
  readonly permissions: Map<string, GitHubRepositoryPermission>;
  readonly failures: { method: GitHubMethod; error: Error }[];
  readonly hooks: { method: GitHubMethod; run: () => Promise<void> }[];
  app: GitHubAppInfo;
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
export class FakeGitHub implements GitHubClient {
  readonly #gate: InstallationGate | undefined;
  /** What a view made by {@link FakeGitHub.withSignal} shares with the fake it was made from. */
  #state: FakeState = {
    calls: [],
    installations: new Map(),
    memberships: new Map(),
    permissions: new Map(),
    failures: [],
    hooks: [],
    app: FAKE_APP,
  };
  #signal: AbortSignal | undefined;

  constructor(options: { gate?: InstallationGate } = {}) {
    this.#gate = options.gate;
  }

  /** Every call served, in order. A call the gate refused is not here. */
  get calls(): RecordedCall[] {
    return this.#state.calls;
  }

  /**
   * A view of this fake for one unit of work (E07-S03): it serves from the same world and records into the same
   * {@link FakeGitHub.calls}, and with `signal` aborted a call rejects with the reason of the signal, whether it was made
   * after the abort (nothing is recorded) or is waiting for a {@link FakeGitHub.beforeNext} hook.
   */
  withSignal(signal: AbortSignal): GitHubClient {
    const view = new FakeGitHub(this.#gate === undefined ? {} : { gate: this.#gate });
    view.#state = this.#state;
    view.#signal = signal;
    return view;
  }

  setApp(app: GitHubAppInfo): void {
    this.#state.app = app;
  }

  /** Adds, or replaces, an installation with the repositories it can reach. */
  addInstallation(installation: GitHubInstallation, repositories: readonly GitHubRepository[] = []): void {
    this.#state.installations.set(installation.id, { installation, repositories: [...repositories] });
  }

  /** Replaces the repositories an installation can reach. @throws Error for an installation never added. */
  setRepositories(githubInstallationId: GithubId, repositories: readonly GitHubRepository[]): void {
    this.#known(githubInstallationId).repositories = [...repositories];
  }

  /** Suspends the installation at `at`, or lifts the suspension with null. @throws Error for an unknown installation. */
  suspend(githubInstallationId: GithubId, at: Date | null): void {
    const entry = this.#known(githubInstallationId);
    entry.installation = { ...entry.installation, suspendedAt: at };
  }

  /** The installation is gone from GitHub (uninstalled). */
  removeInstallation(githubInstallationId: GithubId): void {
    this.#state.installations.delete(githubInstallationId);
  }

  addMembership(githubInstallationId: GithubId, org: string, login: string, membership: GitHubOrgMembership): void {
    this.#state.memberships.set(membershipKey(githubInstallationId, org, login), membership);
  }

  /** Scripts what `GET /repos/{owner}/{repo}/collaborators/{username}/permission` answers to `login` for `fullName` (`owner/name`). */
  addRepositoryPermission(
    githubInstallationId: GithubId,
    fullName: string,
    login: string,
    permission: GitHubRepositoryPermission,
  ): void {
    this.#state.permissions.set(permissionKey(githubInstallationId, fullName, login), permission);
  }

  /** The next call of `method` throws `error` (once, after it is recorded). Several calls queue in order. */
  failNext(method: GitHubMethod, error: Error): void {
    this.#state.failures.push({ method, error });
  }

  /**
   * `run` is awaited once, just before the next call of `method` is answered (and after it is recorded): the world can
   * change while the caller waits for GitHub, as it does on the real network. Several hooks queue in order.
   */
  beforeNext(method: GitHubMethod, run: () => Promise<void>): void {
    this.#state.hooks.push({ method, run });
  }

  getApp(): Promise<GitHubAppInfo> {
    return this.#serve('getApp', undefined, () => this.#state.app);
  }

  getInstallation(githubInstallationId: GithubId): Promise<GitHubInstallation | null> {
    return this.#serve(
      'getInstallation',
      githubInstallationId,
      () => this.#state.installations.get(githubInstallationId)?.installation ?? null,
    );
  }

  listInstallations(): Promise<GitHubInstallation[]> {
    return this.#serve('listInstallations', undefined, () =>
      [...this.#state.installations.values()].map((entry) => entry.installation),
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
      () => this.#state.memberships.get(membershipKey(githubInstallationId, org, login)) ?? null,
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
      () => this.#state.permissions.get(permissionKey(githubInstallationId, `${owner}/${repo}`, login)) ?? null,
    );
  }

  #known(githubInstallationId: GithubId): FakeInstallation {
    const entry = this.#state.installations.get(githubInstallationId);
    if (entry === undefined) {
      throw new Error(`FakeGitHub has no installation ${githubInstallationId}: add it first`);
    }
    return entry;
  }

  /**
   * Records the call, runs a scripted hook, then rejects with a scripted failure or answers with `read()` (which may
   * throw: that rejects too). A view with an aborted signal rejects with its reason before the call is recorded, and
   * while the hook is awaited.
   */
  async #serve<T>(method: GitHubMethod, installationId: GithubId | undefined, read: () => T): Promise<T> {
    const signal = this.#signal;
    signal?.throwIfAborted();
    const { calls, hooks, failures } = this.#state;
    calls.push({ method, installationId });
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
      const entry = this.#state.installations.get(githubInstallationId);
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

/** `work`, or a rejection with the reason of `signal` as soon as it aborts, whichever comes first. */
function abortable<T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> {
  if (signal === undefined) {
    return work;
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
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

/** Removes and returns the first scripted entry for `method`, or undefined. */
function takeFirst<T extends { readonly method: GitHubMethod }>(queue: T[], method: GitHubMethod): T | undefined {
  const index = queue.findIndex((entry) => entry.method === method);
  return index === -1 ? undefined : queue.splice(index, 1)[0];
}

/** GitHub compares organisation and login names without regard to case. */
const membershipKey = (githubInstallationId: GithubId, org: string, login: string): string =>
  `${githubInstallationId}/${org.toLowerCase()}/${login.toLowerCase()}`;

const permissionKey = (githubInstallationId: GithubId, fullName: string, login: string): string =>
  `${githubInstallationId}/${fullName.toLowerCase()}/${login.toLowerCase()}`;

const OPEN_GATE: InstallationGate = { assertAdmitted: () => Promise.resolve() };
