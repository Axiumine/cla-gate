// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { type ContractCase, id, installation, repository } from '../github-contract/test-support.ts';
import { commitSha, pullRequest } from '../github-pull-contract/test-support.ts';
import {
  GitHubNotFoundError,
  InstallationGoneError,
  InstallationNotAdmittedError,
  InstallationSuspendedError,
} from '../ports/github-errors.ts';

// The listing of the open pull requests of a repository (E07-S08) in the contract of the GitHub client port: what the fake and
// the Octokit adapter both answer, so the sweep reads the same list from either. The shapes GitHub can send that a port type
// cannot hold are in the adapter's own tests.

const ACME = 'acme/api';
const ref = (number: number, headSha = commitSha(2)) => ({ number, state: 'open' as const, headSha });

export const OPEN_PULL_CASES: readonly ContractCase[] = [
  [
    'listOpenPullRequests returns the number, state and head SHA of each open pull request, newest first, and leaves the closed ones out',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addPullRequest(id(11), ACME, pullRequest(7));
      addPullRequest(id(11), ACME, pullRequest(9, { headSha: commitSha(5) }));
      addPullRequest(id(11), ACME, pullRequest(8, { state: 'closed' }));
      expect(await client.listOpenPullRequests(id(11), ACME, 1)).toEqual({
        pulls: [ref(9, commitSha(5)), ref(7)],
        last: true,
      });
    },
  ],
  [
    'listOpenPullRequests lists a repository with no open pull request as an empty last page',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      expect(await client.listOpenPullRequests(id(11), ACME, 1)).toEqual({ pulls: [], last: true });
      addPullRequest(id(11), ACME, pullRequest(8, { state: 'closed' }));
      expect(await client.listOpenPullRequests(id(11), ACME, 1)).toEqual({ pulls: [], last: true });
    },
  ],
  [
    'listOpenPullRequests pages by 100: the first page is not the last, the second holds the rest, and a page past the end is empty',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      for (let number = 1; number <= 150; number += 1) {
        addPullRequest(id(11), ACME, pullRequest(number));
      }
      const first = await client.listOpenPullRequests(id(11), ACME, 1);
      expect(first.last).toBe(false);
      expect(first.pulls).toHaveLength(100);
      expect([first.pulls[0]?.number, first.pulls[99]?.number]).toEqual([150, 51]);
      const second = await client.listOpenPullRequests(id(11), ACME, 2);
      expect(second.last).toBe(true);
      expect([second.pulls.length, second.pulls[0]?.number, second.pulls[49]?.number]).toEqual([50, 50, 1]);
      expect(await client.listOpenPullRequests(id(11), ACME, 3)).toEqual({ pulls: [], last: true });
    },
  ],
  [
    'listOpenPullRequests treats the repository name without regard to case, as GitHub does',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addPullRequest(id(11), ACME, pullRequest(7));
      expect(await client.listOpenPullRequests(id(11), 'ACME/Api', 1)).toEqual({ pulls: [ref(7)], last: true });
    },
  ],
  [
    'listOpenPullRequests lists the pull requests of the repository asked for and of the installation asking, and no other',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME), repository(102, 'acme/other')]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      addPullRequest(id(11), ACME, pullRequest(7));
      addPullRequest(id(11), 'acme/other', pullRequest(8));
      addPullRequest(id(12), 'globex/api', pullRequest(9));
      expect((await client.listOpenPullRequests(id(11), ACME, 1)).pulls).toEqual([ref(7)]);
      expect((await client.listOpenPullRequests(id(11), 'acme/other', 1)).pulls).toEqual([ref(8)]);
      expect((await client.listOpenPullRequests(id(12), 'globex/api', 1)).pulls).toEqual([ref(9)]);
    },
  ],
  [
    'listOpenPullRequests is a 404 for a repository the installation does not reach, one of another installation, and a name GitHub cannot hold',
    async ({ client, addInstallation, addPullRequest }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      addPullRequest(id(12), 'globex/api', pullRequest(9));
      const names = [
        'acme/missing',
        'globex/api',
        'acme',
        'acme/',
        '/api',
        '../api',
        'acme/..',
        'acme/api/x',
        'acme/a b',
      ];
      for (const name of names) {
        await expect(client.listOpenPullRequests(id(11), name, 1)).rejects.toBeInstanceOf(GitHubNotFoundError);
      }
    },
  ],
  [
    'listOpenPullRequests answers a view with a signal that has not aborted, and sends nothing once it has',
    async ({ client, addInstallation, addPullRequest, reached }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addPullRequest(id(11), ACME, pullRequest(7));
      const live = client.withSignal(new AbortController().signal);
      expect((await live.listOpenPullRequests(id(11), ACME, 1)).pulls).toEqual([ref(7)]);
      const before = reached();
      const reason = new Error('the job was aborted');
      await expect(client.withSignal(AbortSignal.abort(reason)).listOpenPullRequests(id(11), ACME, 1)).rejects.toBe(
        reason,
      );
      expect(reached()).toBe(before);
    },
  ],
  [
    'listOpenPullRequests is refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, refuse, suspend, reached }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, ACME)]);
      refuse(id(11), 'rejected');
      suspend(id(12), new Date('2026-11-01T09:30:00Z'));
      await expect(client.listOpenPullRequests(id(11), ACME, 1)).rejects.toEqual(
        new InstallationNotAdmittedError('rejected'),
      );
      expect(reached()).toBe(0);
      await expect(client.listOpenPullRequests(id(12), ACME, 1)).rejects.toEqual(
        new InstallationSuspendedError(id(12)),
      );
      await expect(client.listOpenPullRequests(id(13), ACME, 1)).rejects.toEqual(new InstallationGoneError(id(13)));
    },
  ],
];
