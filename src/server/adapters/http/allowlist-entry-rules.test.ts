// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { allowlistGitHubNotWired } from '../../services/allowlist-account.ts';
import { createJobsTable, fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { GitHubNotFoundError } from '../../services/ports/github-errors.ts';
import { containing } from '../db/test-support.ts';
import {
  accountOf,
  addToInstallation,
  addToRepository,
  allowlistWorld,
  DEPENDABOT,
  OTHER_ORGANISATION,
} from './allowlist-entry-fixture/test-support.ts';
import { documentWorld, errorCodeOf, parsed, tablesOf } from './document-fixture/test-support.ts';
import { suspendTenantOne } from './repository-document-fixture/test-support.ts';

// The rules that refuse `POST .../allowlist-entries` (E14-S06): the shape of the body, what GitHub says about the login, the kind of the
// account, the members of the organisation, and GitHub failing. A refused call changes no row of any tenant and never stores what GitHub
// answered. The same checks apply to both routes; the installation one carries them.

/** `expect.stringMatching` is typed `any`; as `unknown` it can sit in an object literal. */
const matching = (pattern: RegExp): unknown => expect.stringMatching(pattern);

const MEMBERS = { kind: 'org_members' } as const;
const ADA_BODY = { kind: 'user', login: 'ada-lovelace' } as const;

/** Sends `body` as the org admin of tenant 1 to the installation route and answers the response, after proving no row changed. */
async function refused(world: Awaited<ReturnType<typeof allowlistWorld>>, body: object) {
  const before = await tablesOf(world);
  const response = await addToInstallation(world, 'admin1', world.t1.installationId, body);
  expect(await tablesOf(world)).toEqual(before);
  return response;
}

test.each([
  ['no kind', {}],
  ['an unknown kind', { kind: 'team', login: 'ada-lovelace' }],
  ['a user with no login', { kind: 'user' }],
  ['a bot with no login', { kind: 'bot' }],
  ['a login that is not text', { kind: 'user', login: 4711 }],
  ['members with a login', { kind: 'org_members', login: 'ada-lovelace' }],
  ['members with an id', { kind: 'org_members', githubId: 31_337 }],
  ['a user with an id', { kind: 'user', login: 'ada-lovelace', githubId: 4711 }],
  ['a user with a repository', { kind: 'user', login: 'ada-lovelace', repositoryId: 1 }],
])('%s is 400 bad_request, GitHub is not asked, and no row changes', async (_name, body) => {
  const world = await allowlistWorld();
  const response = await refused(world, body);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test.each([
  [''],
  [' '],
  ['-ada'],
  ['ada lovelace'],
  ['ada/lovelace'],
  ['../orgs/zzzz'],
  ['<b>zzzz</b>'],
  ['ada_lovelace'],
  ['ada\n'],
  ['a'.repeat(40)],
  ['ada[bot]x'],
  ['ada[bot][bot]'],
  ['[bot]'],
  ['ada%2Flovelace'],
  ['ada?zzzz=1'],
])('the login %j is 400 before any request is made, and nothing of it is in the answer', async (login) => {
  const world = await allowlistWorld();
  for (const kind of ['user', 'bot']) {
    const response = await refused(world, { kind, login });
    expect([response.statusCode, errorCodeOf(response)]).toEqual([400, 'bad_request']);
    expect(response.body).not.toContain('zzzz');
  }
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('a login nobody has on GitHub is 422 github_account_not_found', async () => {
  const world = await allowlistWorld();
  const response = await refused(world, { kind: 'user', login: 'nobody-here' });
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'github_account_not_found']);
});

test.each(['user', 'bot'] as const)(
  'an organisation given as a %s is 422 kind_mismatch, with the hint to use org_members',
  async (kind) => {
    const world = await allowlistWorld();
    const response = await refused(world, { kind, login: OTHER_ORGANISATION.login });
    expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'kind_mismatch']);
    expect(parsed(response, errorResponseSchema).error.details).toEqual({
      hint: containing('org_members'),
    });
  },
);

test('a bot given as a user and a person given as a bot are 422 kind_mismatch, with the hint to use the other kind', async () => {
  const world = await allowlistWorld();
  const botAsUser = await refused(world, { kind: 'user', login: DEPENDABOT.login });
  const userAsBot = await refused(world, { kind: 'bot', login: 'ada-lovelace' });
  expect([botAsUser, userAsBot].map((response) => [response.statusCode, errorCodeOf(response)])).toEqual([
    [422, 'kind_mismatch'],
    [422, 'kind_mismatch'],
  ]);
  expect(parsed(botAsUser, errorResponseSchema).error.details).toEqual({
    hint: containing('person'),
  });
});

test('an account of a type that is neither a person, a bot nor an organisation is 422 kind_mismatch, whatever kind is given', async () => {
  const world = await allowlistWorld([accountOf(7, 'zzzz-enterprise', 'Other')]);
  const asUser = await refused(world, { kind: 'user', login: 'zzzz-enterprise' });
  const asBot = await refused(world, { kind: 'bot', login: 'zzzz-enterprise' });
  expect([asUser, asBot].map((response) => [response.statusCode, errorCodeOf(response)])).toEqual([
    [422, 'kind_mismatch'],
    [422, 'kind_mismatch'],
  ]);
});

test('the same rules hold on the route of a repository', async () => {
  const world = await allowlistWorld();
  const before = await tablesOf(world);
  const answers = [
    await addToRepository(world, 'admin1', world.t1.plain.repositoryId, { kind: 'user', login: 'nobody-here' }),
    await addToRepository(world, 'admin1', world.t1.plain.repositoryId, { kind: 'user', login: DEPENDABOT.login }),
    await addToRepository(world, 'admin1', world.t1.plain.repositoryId, { kind: 'user' }),
  ];
  expect(answers.map((answer) => [answer.statusCode, errorCodeOf(answer)])).toEqual([
    [422, 'github_account_not_found'],
    [422, 'kind_mismatch'],
    [400, 'bad_request'],
  ]);
  expect(await tablesOf(world)).toEqual(before);
});

test('the members of an installation of a user account are 422 no_organization, and GitHub is not asked', async () => {
  const world = await allowlistWorld();
  const owned = await world.db
    .insertInto('installations')
    .values({
      github_installation_id: 6000,
      account_id: world.people.admin1.githubId,
      account_login: world.people.admin1.login,
      account_type: 'User',
      suspended_at: null,
      admission_status: 'admitted',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const before = await tablesOf(world);
  const response = await addToInstallation(world, 'admin1', owned.id, MEMBERS);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'no_organization']);
  expect(await tablesOf(world)).toEqual(before);
  expect(world.fakeGitHub.calls).toEqual([]);
});

test('an installation GitHub no longer knows as an organisation is 422 no_organization too', async () => {
  const world = await allowlistWorld();
  const { t1 } = world;
  const account = { id: t1.accountId, login: t1.accountLogin, type: 'User' } as const;
  world.fakeGitHub.addInstallation({ id: t1.githubInstallationId, account, suspendedAt: null, permissions: {} });
  const response = await refused(world, MEMBERS);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'no_organization']);
});

test('a missing members permission is 422 members_permission_missing with the instruction to accept the updated permissions, and nothing is stored', async () => {
  const world = await allowlistWorld();
  world.fakeGitHub.setMembersProbe(world.t1.githubInstallationId, 'missing');
  const response = await refused(world, MEMBERS);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([422, 'members_permission_missing']);
  expect(parsed(response, errorResponseSchema).error.details).toEqual({
    hint: matching(/accept the updated permissions.*installation page/i),
  });
});

test('the permission is granted again: the same call then succeeds', async () => {
  const world = await allowlistWorld();
  world.fakeGitHub.setMembersProbe(world.t1.githubInstallationId, 'missing');
  const first = await refused(world, MEMBERS);
  world.fakeGitHub.setMembersProbe(world.t1.githubInstallationId, 'granted');
  const second = await addToInstallation(world, 'admin1', world.t1.installationId, MEMBERS);
  expect([first.statusCode, second.statusCode]).toEqual([422, 201]);
});

test('a rate limit on the lookup of a login is 503 github_rate_limited with the wait GitHub asked for', async () => {
  const world = await allowlistWorld();
  world.fakeGitHub.scriptUserAccount('ada-lovelace', 'rate_limited');
  const response = await refused(world, ADA_BODY);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([503, 'github_rate_limited']);
  expect(response.headers['retry-after']).toBe('120');
});

test('a rate limit on the probe of the members permission is 503 github_rate_limited with the wait GitHub asked for', async () => {
  const world = await allowlistWorld();
  world.fakeGitHub.setMembersProbe(world.t1.githubInstallationId, 'rate_limited');
  const response = await refused(world, MEMBERS);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([503, 'github_rate_limited']);
  expect(response.headers['retry-after']).toBe('120');
});

test.each(['unavailable', 'malformed'] as const)(
  'a lookup that GitHub answers as %s is 502 github_unavailable, and the message holds nothing GitHub sent',
  async (failure) => {
    const world = await allowlistWorld();
    world.fakeGitHub.scriptUserAccount('ada-lovelace', failure);
    const response = await refused(world, ADA_BODY);
    expect([response.statusCode, errorCodeOf(response)]).toEqual([502, 'github_unavailable']);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.body).not.toMatch(/GitHub answered|\/users\//);
  },
);

test.each(['unavailable', 'malformed'] as const)(
  'a members probe that GitHub answers as %s is 502 github_unavailable',
  async (failure) => {
    const world = await allowlistWorld();
    world.fakeGitHub.setMembersProbe(world.t1.githubInstallationId, failure);
    const response = await refused(world, MEMBERS);
    expect([response.statusCode, errorCodeOf(response)]).toEqual([502, 'github_unavailable']);
  },
);

test('any other failure of the lookup (a refused token, an unexpected error) is 502 github_unavailable too, with fixed text', async () => {
  const world = await allowlistWorld();
  world.fakeGitHub.failNext('getUserAccount', new GitHubNotFoundError('GET /installations/zzzz-secret'));
  world.fakeGitHub.failNext('probeMembersPermission', new Error('zzzz-secret token expired'));
  const lookup = await refused(world, ADA_BODY);
  const probe = await refused(world, MEMBERS);
  expect([lookup, probe].map((response) => [response.statusCode, errorCodeOf(response)])).toEqual([
    [502, 'github_unavailable'],
    [502, 'github_unavailable'],
  ]);
  expect(lookup.body + probe.body).not.toContain('zzzz-secret');
});

test('a server built with no GitHub App answers 502 github_unavailable to a login and to the members, and stores nothing', async () => {
  const world = await documentWorld({ enqueuer: fakeEnqueuer(), allowlistGitHub: allowlistGitHubNotWired });
  await createJobsTable(world.db);
  const lookup = await refused(world, ADA_BODY);
  const probe = await refused(world, MEMBERS);
  expect([lookup, probe].map((response) => [response.statusCode, errorCodeOf(response)])).toEqual([
    [502, 'github_unavailable'],
    [502, 'github_unavailable'],
  ]);
});

test('a suspended installation is 409 installation_suspended, GitHub is not asked, and no row changes', async () => {
  const world = await allowlistWorld();
  await suspendTenantOne(world);
  const response = await refused(world, ADA_BODY);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([409, 'installation_suspended']);
  expect(world.fakeGitHub.calls.filter((call) => call.method === 'getUserAccount')).toEqual([]);
});
