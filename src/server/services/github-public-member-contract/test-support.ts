// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import type { UserAccountFailure } from '../fake-user-accounts/test-support.ts';
import { type ContractCase, expectInstallationRefusals, id, installation } from '../github-contract/test-support.ts';
import { GitHubRateLimitedError, GitHubResponseError, GitHubUnavailableError } from '../ports/github-errors.ts';

// The check of a public membership (E21-S04) in the contract of the GitHub client port: what the fake and the Octokit adapter both answer.
// The statuses GitHub can send, and what the adapter makes of each, are in the adapter's own test (`octokit-client-public-member.test.ts`).

/** The failures, with the error each is. */
const FAILURES = [
  ['rate_limited', GitHubRateLimitedError],
  ['unavailable', GitHubUnavailableError],
  ['malformed', GitHubResponseError],
] as const satisfies readonly (readonly [UserAccountFailure, unknown])[];

export const PUBLIC_MEMBER_CASES: readonly ContractCase[] = [
  [
    'isPublicOrgMember answers true for a member who shows the membership',
    async ({ client, addInstallation, scriptPublicMember }) => {
      addInstallation(installation(11, 'acme'));
      scriptPublicMember('globex', 'ada', true);
      expect(await client.isPublicOrgMember(id(11), 'globex', 'ada')).toBe(true);
    },
  ],
  [
    'isPublicOrgMember answers false for anyone else: a member who keeps it private, a person of no organisation and an organisation nobody has',
    async ({ client, addInstallation, scriptPublicMember }) => {
      addInstallation(installation(11, 'acme'));
      scriptPublicMember('globex', 'grace', false);
      expect(await client.isPublicOrgMember(id(11), 'globex', 'grace')).toBe(false);
      expect(await client.isPublicOrgMember(id(11), 'globex', 'ada')).toBe(false);
      expect(await client.isPublicOrgMember(id(11), 'initech', 'ada')).toBe(false);
    },
  ],
  [
    'isPublicOrgMember answers for the pair of organisation and login that was asked, and for no other',
    async ({ client, addInstallation, scriptPublicMember }) => {
      addInstallation(installation(11, 'acme'));
      scriptPublicMember('globex', 'ada', true);
      expect(await client.isPublicOrgMember(id(11), 'initech', 'ada')).toBe(false);
      expect(await client.isPublicOrgMember(id(11), 'globex', 'grace')).toBe(false);
    },
  ],
  [
    'isPublicOrgMember compares the organisation and the login without regard to their case',
    async ({ client, addInstallation, scriptPublicMember }) => {
      addInstallation(installation(11, 'acme'));
      scriptPublicMember('Globex', 'Ada', true);
      expect(await client.isPublicOrgMember(id(11), 'GLOBEX', 'ADA')).toBe(true);
      expect(await client.isPublicOrgMember(id(11), 'globex', 'ada')).toBe(true);
    },
  ],
  [
    'isPublicOrgMember answers false for names that cannot be an organisation and a login, even when a member was scripted under that text',
    async ({ client, addInstallation, scriptPublicMember }) => {
      addInstallation(installation(11, 'acme'));
      const hostile = [
        ['../app', 'ada'],
        ['globex/../acme', 'ada'],
        ['globex', 'ada/../grace'],
        ['globex', 'ada lovelace'],
        ['globex corp', 'ada'],
        ['-globex', 'ada'],
        ['globex', '<b>ada</b>'],
        ['globex', ''],
        ['', 'ada'],
      ] as const;
      for (const [org, login] of hostile) {
        scriptPublicMember(org, login, true);
        expect(await client.isPublicOrgMember(id(11), org, login), `the pair ${JSON.stringify([org, login])}`).toBe(
          false,
        );
      }
    },
  ],
  ...FAILURES.map(
    ([failure, error]): ContractCase => [
      `isPublicOrgMember rejects with ${error.name} when GitHub answers "${failure}"`,
      async ({ client, addInstallation, scriptPublicMember }) => {
        addInstallation(installation(11, 'acme'));
        scriptPublicMember('globex', 'ada', failure);
        await expect(client.isPublicOrgMember(id(11), 'globex', 'ada')).rejects.toBeInstanceOf(error);
      },
    ],
  ),
  [
    'isPublicOrgMember is answered for the installation that asks, whichever installation the organisation belongs to',
    async ({ client, addInstallation, scriptPublicMember }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      scriptPublicMember('globex', 'ada', true);
      expect(await client.isPublicOrgMember(id(11), 'globex', 'ada')).toBe(true);
      expect(await client.isPublicOrgMember(id(12), 'globex', 'ada')).toBe(true);
    },
  ],
  [
    'isPublicOrgMember answers a view with a signal that has not aborted, and sends nothing once it has',
    async ({ client, addInstallation, scriptPublicMember, reached }) => {
      addInstallation(installation(11, 'acme'));
      scriptPublicMember('globex', 'ada', true);
      expect(await client.withSignal(new AbortController().signal).isPublicOrgMember(id(11), 'globex', 'ada')).toBe(
        true,
      );
      const before = reached();
      const reason = new Error('the job was aborted');
      await expect(
        client.withSignal(AbortSignal.abort(reason)).isPublicOrgMember(id(11), 'globex', 'ada'),
      ).rejects.toBe(reason);
      expect(reached()).toBe(before);
    },
  ],
  [
    'isPublicOrgMember is refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, scriptPublicMember, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      scriptPublicMember('globex', 'ada', true);
      await expectInstallationRefusals(world, (installationId) => [
        () => client.isPublicOrgMember(id(installationId), 'globex', 'ada'),
      ]);
    },
  ],
];
