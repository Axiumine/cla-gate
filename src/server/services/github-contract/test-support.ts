// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { type GithubId, parseGithubId } from '../../../shared/github-id.ts';
import type { GitHubClient, GitHubInstallation, GitHubOrgMembership, GitHubRepository } from '../ports/github.ts';
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
  /** The instance does not serve this installation: its gate refuses it. */
  readonly refuse: (githubInstallationId: GithubId, reason: NotAdmittedReason) => void;
  /** How many requests reached GitHub (the fake: how many calls it served). */
  readonly reached: () => number;
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
    refuse: (githubInstallationId, reason) => {
      gate.refuse(githubInstallationId, reason);
    },
    reached: () => fake.calls.length,
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
      expect((await client.getInstallation(id(11)))?.id).toBe(11);
    },
  ],
];
