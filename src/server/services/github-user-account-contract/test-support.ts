// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import type { UserAccountFailure } from '../fake-user-accounts/test-support.ts';
import { type ContractCase, expectInstallationRefusals, id, installation } from '../github-contract/test-support.ts';
import type { GitHubUserAccount } from '../ports/github.ts';
import { GitHubRateLimitedError, GitHubResponseError, GitHubUnavailableError } from '../ports/github-errors.ts';

// The lookup of an account by login (E14-S06) in the contract of the GitHub client port: what the fake and the Octokit adapter
// both answer. The shapes and statuses GitHub can send, and what the adapter makes of each, are in the adapter's own test
// (`octokit-client-user-account.test.ts`) over the fixtures next to the adapter.

const ADA: GitHubUserAccount = { id: id(501), login: 'ada', type: 'User' };
const DEPENDABOT: GitHubUserAccount = { id: id(49_699_333), login: 'dependabot[bot]', type: 'Bot' };
const ACME: GitHubUserAccount = { id: id(9000), login: 'acme', type: 'Organization' };

/** The failures, with the error each is. */
const FAILURES = [
  ['rate_limited', GitHubRateLimitedError],
  ['unavailable', GitHubUnavailableError],
  ['malformed', GitHubResponseError],
] as const satisfies readonly (readonly [UserAccountFailure, unknown])[];

export const USER_ACCOUNT_CASES: readonly ContractCase[] = [
  [
    'getUserAccount returns the id, the login and the type of a user, of a bot and of an organisation',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      for (const account of [ADA, DEPENDABOT, ACME]) {
        scriptUserAccount(account.login, account);
        expect(await client.getUserAccount(id(11), account.login)).toEqual(account);
      }
    },
  ],
  [
    'getUserAccount finds a login without regard to its case and answers with the login as GitHub keeps it',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      scriptUserAccount('Ada', ADA);
      expect(await client.getUserAccount(id(11), 'ADA')).toEqual(ADA);
    },
  ],
  [
    'getUserAccount resolves null for a login nobody has',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      scriptUserAccount('ada', ADA);
      expect(await client.getUserAccount(id(11), 'grace')).toBeNull();
    },
  ],
  [
    'getUserAccount resolves null for a login that cannot be one, even when an account was scripted under that text',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      const hostile = ['../app', 'ada lovelace', '<b>ada</b>', 'ada/../grace', 'ada_lovelace', '-ada', ''];
      for (const login of hostile) {
        scriptUserAccount(login, ADA);
        expect(await client.getUserAccount(id(11), login), `the login ${JSON.stringify(login)}`).toBeNull();
      }
    },
  ],
  ...FAILURES.map(
    ([failure, error]): ContractCase => [
      `getUserAccount rejects with ${error.name} when GitHub answers "${failure}"`,
      async ({ client, addInstallation, scriptUserAccount }) => {
        addInstallation(installation(11, 'acme'));
        scriptUserAccount('ada', failure);
        await expect(client.getUserAccount(id(11), 'ada')).rejects.toBeInstanceOf(error);
      },
    ],
  ),
  [
    'getUserAccount is answered for the installation that asks, whichever installation holds the account',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      scriptUserAccount('ada', ADA);
      expect(await client.getUserAccount(id(11), 'ada')).toEqual(ADA);
      expect(await client.getUserAccount(id(12), 'ada')).toEqual(ADA);
    },
  ],
  [
    'getUserAccount answers a view with a signal that has not aborted, and sends nothing once it has',
    async ({ client, addInstallation, scriptUserAccount, reached }) => {
      addInstallation(installation(11, 'acme'));
      scriptUserAccount('ada', ADA);
      expect(await client.withSignal(new AbortController().signal).getUserAccount(id(11), 'ada')).toEqual(ADA);
      const before = reached();
      const reason = new Error('the job was aborted');
      await expect(client.withSignal(AbortSignal.abort(reason)).getUserAccount(id(11), 'ada')).rejects.toBe(reason);
      expect(reached()).toBe(before);
    },
  ],
  [
    'getUserAccount is refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, scriptUserAccount, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      scriptUserAccount('ada', ADA);
      await expectInstallationRefusals(world, (installationId) => [
        () => client.getUserAccount(id(installationId), 'ada'),
      ]);
    },
  ],
];

const GLOBEX: GitHubUserAccount = { id: id(9001), login: 'Globex', type: 'Organization' };

// The lookup of an organisation by login (E21-S03): the same accounts and failures, asked on `GET /orgs/{org}`, which has no person.
export const ORGANIZATION_ACCOUNT_CASES: readonly ContractCase[] = [
  [
    'getOrganizationAccount returns the id, the login and the type of an organisation, without regard to the case of the login',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      scriptUserAccount('Globex', GLOBEX);
      expect(await client.getOrganizationAccount(id(11), 'globex')).toEqual(GLOBEX);
      expect(await client.getOrganizationAccount(id(11), 'GLOBEX')).toEqual(GLOBEX);
    },
  ],
  [
    'getOrganizationAccount resolves null for a login nobody has and for the login of a person or a bot',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      scriptUserAccount('ada', ADA);
      scriptUserAccount('dependabot[bot]', DEPENDABOT);
      for (const login of ['grace', 'ada', 'dependabot[bot]']) {
        expect(await client.getOrganizationAccount(id(11), login), login).toBeNull();
      }
    },
  ],
  [
    'getOrganizationAccount resolves null for a login that cannot be an organisation, even when an account was scripted under that text',
    async ({ client, addInstallation, scriptUserAccount }) => {
      addInstallation(installation(11, 'acme'));
      for (const login of [
        '../app',
        'acme corp',
        '<b>acme</b>',
        'acme/../globex',
        'acme_corp',
        '-acme',
        '',
        'acme[bot]',
      ]) {
        scriptUserAccount(login, ACME);
        expect(await client.getOrganizationAccount(id(11), login), `the login ${JSON.stringify(login)}`).toBeNull();
      }
    },
  ],
  ...FAILURES.map(
    ([failure, error]): ContractCase => [
      `getOrganizationAccount rejects with ${error.name} when GitHub answers "${failure}"`,
      async ({ client, addInstallation, scriptUserAccount }) => {
        addInstallation(installation(11, 'acme'));
        scriptUserAccount('acme', failure);
        await expect(client.getOrganizationAccount(id(11), 'acme')).rejects.toBeInstanceOf(error);
      },
    ],
  ),
  [
    'getOrganizationAccount is refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, scriptUserAccount, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      scriptUserAccount('acme', ACME);
      await expectInstallationRefusals(world, (installationId) => [
        () => client.getOrganizationAccount(id(installationId), 'acme'),
      ]);
    },
  ],
];
