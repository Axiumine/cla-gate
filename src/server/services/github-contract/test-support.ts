// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import type {
  GitHubClient,
  GitHubClient,
  GitHubCommit,
  GitHubInstallation,
  GitHubIssueComment,
  GitHubOrgMembership,
  GitHubPullRequest,
  GitHubPullRequestRef,
  GitHubRepository,
  GitHubRepositoryPermission,
} from '../ports/github.ts';
import {
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
  type NotAdmittedReason,
} from '../ports/github-errors.ts';
import { FakeGate, FakeGitHub } from '../test-support.ts';

// The contract of the GitHub client port (E05-S04): what every implementation answers, written once. It runs against
// FakeGitHub (services/github-contract/fake.test.ts) and against the Octokit adapter backed by MSW
// (adapters/github/octokit-client.contract.test.ts), so the fake the other epics test with cannot drift from the adapter.

/** A GitHub, scripted by a test and read through the client under test. */
export interface GitHubWorld {
  readonly client: GitHubClient;
  readonly addInstallation: (installation: GitHubInstallation, repositories?: readonly GitHubRepository[]) => void;
  /** Suspends an installation added before. */
  readonly suspend: (githubInstallationId: GithubId, at: Date) => void;
  readonly addMembership: (
    githubInstallationId: GithubId,
    org: string,
    login: string,
    membership: GitHubOrgMembership,
  ) => void;
  /** What the permission call answers to `login` for the repository `fullName` (`owner/name`). */
  readonly addRepositoryPermission: (
    githubInstallationId: GithubId,
    fullName: string,
    login: string,
    permission: GitHubRepositoryPermission,
  ) => void;
  /** A pull request of a repository (`owner/name`) of an installation. */
  readonly addPullRequest: (githubInstallationId: GithubId, fullName: string, pullRequest: GitHubPullRequest) => void;
  /** What `listPullRequestCommits` lists for a pull request, in order. */
  readonly setPullRequestCommits: (
    githubInstallationId: GithubId,
    fullName: string,
    prNumber: number,
    commits: readonly GitHubCommit[],
  ) => void;
  /** What `listRepositoryCommits` lists for a repository, in order. */
  readonly setRepositoryCommits: (
    githubInstallationId: GithubId,
    fullName: string,
    commits: readonly GitHubCommit[],
  ) => void;
  /** The merge base `compareCommits` answers for two commits. */
  readonly setMergeBase: (
    githubInstallationId: GithubId,
    fullName: string,
    commits: { readonly baseSha: string; readonly headSha: string },
    mergeBaseSha: string,
  ) => void;
  /** A comment of a repository (`owner/name`) of an installation. */
  readonly addIssueComment: (githubInstallationId: GithubId, fullName: string, comment: GitHubIssueComment) => void;
  /** What `listPullRequestsForCommit` lists for a commit. */
  readonly setCommitPullRequests: (
    githubInstallationId: GithubId,
    fullName: string,
    headSha: string,
    pulls: readonly GitHubPullRequestRef[],
  ) => void;
  /** The instance does not serve this installation: its gate refuses it. */
  readonly refuse: (githubInstallationId: GithubId, reason: NotAdmittedReason) => void;
  /** How many requests reached GitHub (the fake: how many calls it served). */
  readonly reached: () => number;
  /** The next `getInstallation` waits for GitHub's answer until `release` is called; `arrived` settles when it is waiting. */
  readonly stallGetInstallation: () => { readonly arrived: Promise<void>; readonly release: () => void };
}

export const id = parseGithubId;

export function installation(
  githubId: number,
  login: string,
  overrides: Partial<GitHubInstallation> = {},
): GitHubInstallation {
  return {
    id: id(githubId),
    account: { id: id(githubId + 5000), login, type: 'Organization' },
    suspendedAt: null,
    permissions: { checks: 'write', metadata: 'read', pull_requests: 'write' },
    ...overrides,
  };
}

export function repository(githubId: number, fullName: string): GitHubRepository {
  return { id: id(githubId), fullName };
}

/** `count` repositories with consecutive ids from `first`, named `acme/repo-<id>`. */
export function repositories(first: number, count: number): GitHubRepository[] {
  return Array.from({ length: count }, (_, index) => repository(first + index, `acme/repo-${first + index}`));
}

const MEMBER: GitHubOrgMembership = { state: 'active', role: 'member', userId: id(77) };

const WRITER: GitHubRepositoryPermission = { permission: 'write', userId: id(77) };

/** The fake as a world: scripts FakeGitHub, with a gate that admits everyone but the installations a test refuses. */
export function fakeWorld(): GitHubWorld & { readonly fake: FakeGitHub } {
  const gate = new FakeGate();
  const fake = new FakeGitHub({ gate });
  return {
    fake,
    client: fake,
    addInstallation: (installationToAdd, repositoriesToAdd) => {
      fake.addInstallation(installationToAdd, repositoriesToAdd);
    },
    suspend: (githubInstallationId, at) => {
      fake.suspend(githubInstallationId, at);
    },
    addMembership: (githubInstallationId, org, login, membership) => {
      fake.addMembership(githubInstallationId, org, login, membership);
    },
    addRepositoryPermission: (githubInstallationId, fullName, login, permission) => {
      fake.addRepositoryPermission(githubInstallationId, fullName, login, permission);
    },
    addPullRequest: (githubInstallationId, fullName, pullRequest) => {
      fake.addPullRequest(githubInstallationId, fullName, pullRequest);
    },
    setPullRequestCommits: (githubInstallationId, fullName, prNumber, commits) => {
      fake.setPullRequestCommits(githubInstallationId, fullName, prNumber, commits);
    },
    setRepositoryCommits: (githubInstallationId, fullName, commits) => {
      fake.setRepositoryCommits(githubInstallationId, fullName, commits);
    },
    setMergeBase: (githubInstallationId, fullName, commits, mergeBaseSha) => {
      fake.setMergeBase(githubInstallationId, fullName, commits, mergeBaseSha);
    },
    addIssueComment: (githubInstallationId, fullName, comment) => {
      fake.addIssueComment(githubInstallationId, fullName, comment);
    },
    setCommitPullRequests: (githubInstallationId, fullName, headSha, pulls) => {
      fake.setCommitPullRequests(githubInstallationId, fullName, headSha, pulls);
    },
    refuse: (githubInstallationId, reason) => {
      gate.refuse(githubInstallationId, reason);
    },
    reached: () => fake.calls.length,
    stallGetInstallation: () => stallNext(fake),
  };
}

/** The next `getInstallation` of `fake` waits until the test lets it go; `arrived` settles when it is waiting. */
function stallNext(fake: FakeGitHub): { readonly arrived: Promise<void>; readonly release: () => void } {
  const arrived = Promise.withResolvers<undefined>();
  const released = Promise.withResolvers<undefined>();
  fake.beforeNext('getInstallation', () => {
    arrived.resolve(undefined);
    return released.promise;
  });
  return {
    arrived: arrived.promise,
    release: () => {
      released.resolve(undefined);
    },
  };
}

export type ContractCase = readonly [name: string, run: (world: GitHubWorld) => Promise<void>];

/** The cases, as `test.each` rows. */
export const CONTRACT_CASES: readonly ContractCase[] = [
  [
    'getApp returns the App id, slug, owner and permissions',
    async ({ client }) => {
      const app = await client.getApp();
      expect([app.id, app.slug, app.owner.id, app.owner.type]).toEqual([4242, 'cla-gate-test', 9001, 'Organization']);
      expect(app.permissions).toEqual({ checks: 'write', metadata: 'read', pull_requests: 'read' });
    },
  ],
  [
    'getInstallation returns the installation with its account, permissions and no suspension',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      expect(await client.getInstallation(id(11))).toEqual(installation(11, 'acme'));
    },
  ],
  [
    'getInstallation returns the time an installation was suspended, and still returns it',
    async ({ client, addInstallation, suspend }) => {
      addInstallation(installation(11, 'acme'));
      suspend(id(11), new Date('2026-11-01T09:30:00Z'));
      expect((await client.getInstallation(id(11)))?.suspendedAt).toEqual(new Date('2026-11-01T09:30:00Z'));
    },
  ],
  [
    'getInstallation resolves null for an installation GitHub does not have',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      expect(await client.getInstallation(id(12))).toBeNull();
    },
  ],
  [
    'listInstallations returns every installation of the App',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex', { suspendedAt: new Date('2026-11-01T09:30:00Z') }));
      const listed = await client.listInstallations();
      expect(listed.map((each) => [each.id, each.account.login, each.suspendedAt === null])).toEqual([
        [11, 'acme', true],
        [12, 'globex', false],
      ]);
    },
  ],
  [
    'listInstallations returns an empty list for an App nobody installed',
    async ({ client }) => {
      expect(await client.listInstallations()).toEqual([]);
    },
  ],
  [
    'listInstallations returns all 250 installations, however many pages that takes',
    async ({ client, addInstallation }) => {
      for (let n = 1; n <= 250; n += 1) {
        addInstallation(installation(n, `org-${n}`));
      }
      const listed = await client.listInstallations();
      expect(listed.map((each) => each.id)).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
    },
  ],
  [
    'listInstallationRepositories returns the repositories of that installation and no other',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, 'acme/api'), repository(102, 'acme/web')]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      expect(await client.listInstallationRepositories(id(11))).toEqual([
        repository(101, 'acme/api'),
        repository(102, 'acme/web'),
      ]);
      expect(await client.listInstallationRepositories(id(12))).toEqual([repository(201, 'globex/api')]);
    },
  ],
  [
    'listInstallationRepositories returns an empty list for an installation with no repository',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      expect(await client.listInstallationRepositories(id(11))).toEqual([]);
    },
  ],
  [
    'listInstallationRepositories returns all 250 repositories, however many pages that takes',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), repositories(1000, 250));
      expect(await client.listInstallationRepositories(id(11))).toEqual(repositories(1000, 250));
    },
  ],
  [
    'getRepositoryById returns a repository the installation can reach',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
      expect(await client.getRepositoryById(id(11), id(101))).toEqual(repository(101, 'acme/api'));
    },
  ],
  [
    'getRepositoryById resolves null for a repository of another installation, and for one nobody has',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      expect(await client.getRepositoryById(id(11), id(201))).toBeNull();
      expect(await client.getRepositoryById(id(11), id(999))).toBeNull();
    },
  ],
  [
    'getOrgMembership returns state, role and the member id',
    async ({ client, addInstallation, addMembership }) => {
      addInstallation(installation(11, 'acme'));
      addMembership(id(11), 'acme', 'alice', { state: 'active', role: 'admin', userId: id(501) });
      addMembership(id(11), 'acme', 'bob', { state: 'pending', role: 'member', userId: id(502) });
      expect(await client.getOrgMembership(id(11), 'acme', 'alice')).toEqual({
        state: 'active',
        role: 'admin',
        userId: 501,
      });
      expect(await client.getOrgMembership(id(11), 'acme', 'bob')).toEqual({
        state: 'pending',
        role: 'member',
        userId: 502,
      });
    },
  ],
  [
    'getOrgMembership treats names without regard to case, as GitHub does',
    async ({ client, addInstallation, addMembership }) => {
      addInstallation(installation(11, 'acme'));
      addMembership(id(11), 'acme', 'alice', MEMBER);
      expect(await client.getOrgMembership(id(11), 'ACME', 'Alice')).toEqual(MEMBER);
    },
  ],
  [
    'getOrgMembership resolves null for a person who is no member, and for a membership of another installation',
    async ({ client, addInstallation, addMembership }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      addMembership(id(12), 'globex', 'alice', MEMBER);
      expect(await client.getOrgMembership(id(11), 'acme', 'alice')).toBeNull();
      expect(await client.getOrgMembership(id(11), 'globex', 'alice')).toBeNull();
    },
  ],
  [
    'getOrgMembership resolves null for a name GitHub cannot hold',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      for (const login of ['../app', 'a/b', 'alice?x=1', '', '..', 'a b']) {
        expect(await client.getOrgMembership(id(11), 'acme', login)).toBeNull();
      }
      expect(await client.getOrgMembership(id(11), '../orgs/other', 'alice')).toBeNull();
    },
  ],
  [
    'getRepositoryPermission returns the base permission and the id of the person',
    async ({ client, addInstallation, addRepositoryPermission }) => {
      addInstallation(installation(11, 'acme'));
      addRepositoryPermission(id(11), 'acme/api', 'alice', { permission: 'admin', userId: id(501) });
      addRepositoryPermission(id(11), 'acme/api', 'bob', { permission: 'maintain', userId: id(502) });
      expect(await client.getRepositoryPermission(id(11), 'acme', 'api', 'alice')).toEqual({
        permission: 'admin',
        userId: 501,
      });
      expect(await client.getRepositoryPermission(id(11), 'acme', 'api', 'bob')).toEqual({
        permission: 'maintain',
        userId: 502,
      });
    },
  ],
  [
    'getRepositoryPermission treats names without regard to case, as GitHub does, and takes the dots of a repository name',
    async ({ client, addInstallation, addRepositoryPermission }) => {
      addInstallation(installation(11, 'acme'));
      addRepositoryPermission(id(11), 'acme/.github', 'alice', WRITER);
      addRepositoryPermission(id(11), 'acme/my.repo', 'alice', WRITER);
      expect(await client.getRepositoryPermission(id(11), 'ACME', '.GitHub', 'Alice')).toEqual(WRITER);
      expect(await client.getRepositoryPermission(id(11), 'acme', 'my.repo', 'alice')).toEqual(WRITER);
    },
  ],
  [
    'getRepositoryPermission resolves null for a person or a repository GitHub has not got, and for a permission of another installation',
    async ({ client, addInstallation, addRepositoryPermission }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      addRepositoryPermission(id(11), 'acme/api', 'alice', WRITER);
      addRepositoryPermission(id(12), 'globex/api', 'alice', WRITER);
      expect(await client.getRepositoryPermission(id(11), 'acme', 'api', 'bob')).toBeNull();
      expect(await client.getRepositoryPermission(id(11), 'acme', 'web', 'alice')).toBeNull();
      expect(await client.getRepositoryPermission(id(11), 'globex', 'api', 'alice')).toBeNull();
    },
  ],
  [
    'getRepositoryPermission resolves null for a name GitHub cannot hold',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      for (const login of ['../app', 'a/b', 'alice?x=1', '', '..', 'a b']) {
        expect(await client.getRepositoryPermission(id(11), 'acme', 'api', login)).toBeNull();
      }
      for (const repo of ['..', '.', 'a/b', '', 'api?x=1', 'a b', '%2e%2e']) {
        expect(await client.getRepositoryPermission(id(11), 'acme', repo, 'alice')).toBeNull();
      }
      expect(await client.getRepositoryPermission(id(11), '../orgs/other', 'api', 'alice')).toBeNull();
    },
  ],
  [
    'withSignal answers as the client does while the signal has not aborted, from the same world',
    async ({ client, addInstallation, addMembership }) => {
      addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
      addMembership(id(11), 'acme', 'alice', MEMBER);
      const view = client.withSignal(new AbortController().signal);
      expect(await view.getInstallation(id(11))).toEqual(installation(11, 'acme'));
      expect(await view.getRepositoryById(id(11), id(101))).toEqual(repository(101, 'acme/api'));
      expect(await view.getOrgMembership(id(11), 'acme', 'alice')).toEqual(MEMBER);
    },
  ],
  [
    'withSignal sends nothing, not even a token request, once the signal has aborted, and rejects with its reason',
    async ({ client, addInstallation, reached }) => {
      addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
      const reason = new Error('the job was aborted');
      const view = client.withSignal(AbortSignal.abort(reason));
      for (const call of [
        () => view.getApp(),
        () => view.getInstallation(id(11)),
        () => view.listInstallations(),
        () => view.listInstallationRepositories(id(11)),
        () => view.getRepositoryById(id(11), id(101)),
        () => view.getOrgMembership(id(11), 'acme', 'alice'),
      ]) {
        await expect(call()).rejects.toBe(reason);
      }
      expect(reached()).toBe(0);
    },
  ],
  [
    'withSignal rejects a call that is waiting for GitHub with the reason of the signal when it aborts, and leaves the client alone',
    async ({ client, addInstallation, stallGetInstallation }) => {
      addInstallation(installation(11, 'acme'));
      const stalled = stallGetInstallation();
      const reason = new Error('the job was aborted at its deadline');
      const abort = new AbortController();
      const waiting = expect(client.withSignal(abort.signal).getInstallation(id(11))).rejects.toBe(reason);
      await stalled.arrived;
      abort.abort(reason);
      await waiting;
      stalled.release();
      expect(await client.getInstallation(id(11))).toEqual(installation(11, 'acme'));
    },
  ],
  [
    'an installation the gate refuses is refused by every installation-level method, before GitHub is asked',
    async ({ client, addInstallation, refuse, reached }) => {
      addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
      refuse(id(11), 'rejected');
      // Thunks, so that each call is made and awaited in turn: no promise waits unobserved while another one is awaited.
      const refused = [
        () => client.listInstallationRepositories(id(11)),
        () => client.getRepositoryById(id(11), id(101)),
        () => client.getOrgMembership(id(11), 'acme', 'alice'),
        () => client.getOrgMembership(id(11), '../orgs/other', '..'),
        () => client.getRepositoryPermission(id(11), 'acme', 'api', 'alice'),
        () => client.getRepositoryPermission(id(11), 'acme', '..', '..'),
      ];
      for (const call of refused) {
        await expect(call()).rejects.toEqual(new InstallationNotAdmittedError('rejected'));
      }
      expect(reached()).toBe(0);
    },
  ],
  [
    'an installation GitHub no longer has is gone for every installation-level method',
    async ({ client }) => {
      const gone = new InstallationGoneError(id(11));
      await expect(client.listInstallationRepositories(id(11))).rejects.toEqual(gone);
      await expect(client.getRepositoryById(id(11), id(101))).rejects.toEqual(gone);
      await expect(client.getOrgMembership(id(11), 'acme', 'alice')).rejects.toEqual(gone);
      await expect(client.getRepositoryPermission(id(11), 'acme', 'api', 'alice')).rejects.toEqual(gone);
    },
  ],
  [
    'a suspended installation is suspended for every installation-level method, yet getInstallation still sees it',
    async ({ client, addInstallation, suspend }) => {
      addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
      suspend(id(11), new Date('2026-11-01T09:30:00Z'));
      const suspended = new InstallationSuspendedError(id(11));
      await expect(client.listInstallationRepositories(id(11))).rejects.toEqual(suspended);
      await expect(client.getRepositoryById(id(11), id(101))).rejects.toEqual(suspended);
      await expect(client.getOrgMembership(id(11), 'acme', 'alice')).rejects.toEqual(suspended);
      await expect(client.getRepositoryPermission(id(11), 'acme', 'api', 'alice')).rejects.toEqual(suspended);
      expect((await client.getInstallation(id(11)))?.id).toBe(11);
    },
  ],
];
