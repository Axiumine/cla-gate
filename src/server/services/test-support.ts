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
  | 'getOrgMembership';

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
  /** Every call served, in order. A call the gate refused is not here. */
  readonly calls: RecordedCall[] = [];
  readonly #gate: InstallationGate | undefined;
  readonly #installations = new Map<GithubId, FakeInstallation>();
  readonly #memberships = new Map<string, GitHubOrgMembership>();
  readonly #failures: { method: GitHubMethod; error: Error }[] = [];
  readonly #hooks: { method: GitHubMethod; run: () => Promise<void> }[] = [];
  #app: GitHubAppInfo = FAKE_APP;

  constructor(options: { gate?: InstallationGate } = {}) {
    this.#gate = options.gate;
  }

  setApp(app: GitHubAppInfo): void {
    this.#app = app;
  }

  /** Adds, or replaces, an installation with the repositories it can reach. */
  addInstallation(installation: GitHubInstallation, repositories: readonly GitHubRepository[] = []): void {
    this.#installations.set(installation.id, { installation, repositories: [...repositories] });
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
    this.#installations.delete(githubInstallationId);
  }

  addMembership(githubInstallationId: GithubId, org: string, login: string, membership: GitHubOrgMembership): void {
    this.#memberships.set(membershipKey(githubInstallationId, org, login), membership);
  }

  /** The next call of `method` throws `error` (once, after it is recorded). Several calls queue in order. */
  failNext(method: GitHubMethod, error: Error): void {
    this.#failures.push({ method, error });
  }

  /**
   * `run` is awaited once, just before the next call of `method` is answered (and after it is recorded): the world can
   * change while the caller waits for GitHub, as it does on the real network. Several hooks queue in order.
   */
  beforeNext(method: GitHubMethod, run: () => Promise<void>): void {
    this.#hooks.push({ method, run });
  }

  getApp(): Promise<GitHubAppInfo> {
    return this.#serve('getApp', undefined, () => this.#app);
  }

  getInstallation(githubInstallationId: GithubId): Promise<GitHubInstallation | null> {
    return this.#serve(
      'getInstallation',
      githubInstallationId,
      () => this.#installations.get(githubInstallationId)?.installation ?? null,
    );
  }

  listInstallations(): Promise<GitHubInstallation[]> {
    return this.#serve('listInstallations', undefined, () =>
      [...this.#installations.values()].map((entry) => entry.installation),
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
      () => this.#memberships.get(membershipKey(githubInstallationId, org, login)) ?? null,
    );
  }

  #known(githubInstallationId: GithubId): FakeInstallation {
    const entry = this.#installations.get(githubInstallationId);
    if (entry === undefined) {
      throw new Error(`FakeGitHub has no installation ${githubInstallationId}: add it first`);
    }
    return entry;
  }

  /** Records the call, runs a scripted hook, then rejects with a scripted failure or answers with `read()` (which may throw: that rejects too). */
  #serve<T>(method: GitHubMethod, installationId: GithubId | undefined, read: () => T): Promise<T> {
    this.calls.push({ method, installationId });
    const hook = takeFirst(this.#hooks, method);
    const scripted = takeFirst(this.#failures, method);
    return (hook?.run() ?? Promise.resolve()).then(() => {
      if (scripted !== undefined) {
        throw scripted.error;
      }
      return read();
    });
  }

  /** {@link FakeGitHub.#serve} for a method that acts with the installation's token: the gate and the token's answers first. */
  async #serveInstallation<T>(
    method: GitHubMethod,
    githubInstallationId: GithubId,
    read: (entry: FakeInstallation) => T,
  ): Promise<T> {
    await (this.#gate ?? OPEN_GATE).assertAdmitted(githubInstallationId);
    return this.#serve(method, githubInstallationId, () => {
      const entry = this.#installations.get(githubInstallationId);
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

/** Removes and returns the first scripted entry for `method`, or undefined. */
function takeFirst<T extends { readonly method: GitHubMethod }>(queue: T[], method: GitHubMethod): T | undefined {
  const index = queue.findIndex((entry) => entry.method === method);
  return index === -1 ? undefined : queue.splice(index, 1)[0];
}

/** GitHub compares organisation and login names without regard to case. */
const membershipKey = (githubInstallationId: GithubId, org: string, login: string): string =>
  `${githubInstallationId}/${org.toLowerCase()}/${login.toLowerCase()}`;

const OPEN_GATE: InstallationGate = { assertAdmitted: () => Promise.resolve() };
