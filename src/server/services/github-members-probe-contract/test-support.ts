// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { type ContractCase, expectInstallationRefusals, id, installation } from '../github-contract/test-support.ts';
import {
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../ports/github-errors.ts';

// The members permission probe (E14-S05) in the contract of the GitHub client port: what the fake and the Octokit adapter
// both answer. The shapes and statuses GitHub can send, and what the adapter makes of each, are in the adapter's own test
// (`octokit-client-members-probe.test.ts`) over the fixtures next to the adapter.

/** The answers that fail, with the error each is. */
const FAILURES = [
  ['rate_limited', GitHubRateLimitedError],
  ['unavailable', GitHubUnavailableError],
  ['malformed', GitHubResponseError],
] as const;

/** An installation of a user: it has no organisation, so it has no members to list. */
const ADA = installation(11, 'ada', { account: { id: id(5011), login: 'ada', type: 'User' } });

export const MEMBERS_PROBE_CASES: readonly ContractCase[] = [
  [
    'probeMembersPermission answers true when GitHub lets the installation list the members of its organisation',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'));
      expect(await client.probeMembersPermission(id(11))).toBe(true);
    },
  ],
  [
    'probeMembersPermission answers false for a 403 that is a missing permission',
    async ({ client, addInstallation, scriptMembersProbe }) => {
      addInstallation(installation(11, 'acme'));
      scriptMembersProbe(id(11), 'missing');
      expect(await client.probeMembersPermission(id(11))).toBe(false);
    },
  ],
  ...FAILURES.map(
    ([answer, error]): ContractCase => [
      `probeMembersPermission rejects with ${error.name} when GitHub answers "${answer}"`,
      async ({ client, addInstallation, scriptMembersProbe }) => {
        addInstallation(installation(11, 'acme'));
        scriptMembersProbe(id(11), answer);
        await expect(client.probeMembersPermission(id(11))).rejects.toBeInstanceOf(error);
      },
    ],
  ),
  [
    'probeMembersPermission is not cached: an operator who accepts the permission is answered at once, and one who takes it back too',
    async ({ client, addInstallation, scriptMembersProbe }) => {
      addInstallation(installation(11, 'acme'));
      scriptMembersProbe(id(11), 'missing');
      expect(await client.probeMembersPermission(id(11))).toBe(false);
      scriptMembersProbe(id(11), 'granted');
      expect(await client.probeMembersPermission(id(11))).toBe(true);
      scriptMembersProbe(id(11), 'missing');
      expect(await client.probeMembersPermission(id(11))).toBe(false);
    },
  ],
  [
    'probeMembersPermission answers for the installation that asks and for no other',
    async ({ client, addInstallation, scriptMembersProbe }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      scriptMembersProbe(id(12), 'missing');
      expect(await client.probeMembersPermission(id(11))).toBe(true);
      expect(await client.probeMembersPermission(id(12))).toBe(false);
      scriptMembersProbe(id(11), 'missing');
      scriptMembersProbe(id(12), 'granted');
      expect(await client.probeMembersPermission(id(11))).toBe(false);
      expect(await client.probeMembersPermission(id(12))).toBe(true);
    },
  ],
  [
    'probeMembersPermission rejects with GitHubNotFoundError for the installation of a user, which has no organisation to ask about',
    async ({ client, addInstallation, scriptMembersProbe }) => {
      addInstallation(ADA);
      scriptMembersProbe(id(11), 'granted');
      await expect(client.probeMembersPermission(id(11))).rejects.toBeInstanceOf(GitHubNotFoundError);
    },
  ],
  [
    'probeMembersPermission answers a view with a signal that has not aborted, and sends nothing once it has',
    async ({ client, addInstallation, reached }) => {
      addInstallation(installation(11, 'acme'));
      expect(await client.withSignal(new AbortController().signal).probeMembersPermission(id(11))).toBe(true);
      const before = reached();
      const reason = new Error('the job was aborted');
      await expect(client.withSignal(AbortSignal.abort(reason)).probeMembersPermission(id(11))).rejects.toBe(reason);
      expect(reached()).toBe(before);
    },
  ],
  [
    'probeMembersPermission is refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      await expectInstallationRefusals(world, (installationId) => [
        () => client.probeMembersPermission(id(installationId)),
      ]);
    },
  ],
];
