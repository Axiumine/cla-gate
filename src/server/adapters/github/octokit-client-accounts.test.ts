// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { clientFixture, installationJson, json } from './client-fixture/test-support.ts';

// An installation of an account that is not a user or an organisation (E05-S04, S07): it is read as account type `Other`,
// so the platform can record it as rejected, and it never makes the list of installations of every tenant unreadable.

const id = parseGithubId;
const LEAK = { token: 'ghs_must_not_be_echoed' };

const enterprise = { id: 7001, login: 'big-co', type: 'Enterprise', ...LEAK };
const enterpriseOnGitHub = { id: 7002, slug: 'big-co', name: 'Big Co', node_id: 'E_kgDOMadeUp', ...LEAK };

const typesOf = async (accounts: Record<string, unknown>[]) => {
  const bodies = accounts.map((account, index) => installationJson(11 + index, { account }));
  const { client } = clientFixture({ 'GET /app/installations': () => json(bodies) });
  return (await client.listInstallations()).map(({ id: installation, account }) => ({ installation, account }));
};

test('one installation of an enterprise between two good ones does not fail the list: it is read as Other', async () => {
  const good = { login: 'acme', type: 'Organization' };
  expect(await typesOf([{ id: 1, ...good }, enterprise, { id: 3, login: 'jane', type: 'User' }])).toEqual([
    { installation: 11, account: { id: 1, login: 'acme', type: 'Organization' } },
    { installation: 12, account: { id: 7001, login: 'big-co', type: 'Other' } },
    { installation: 13, account: { id: 3, login: 'jane', type: 'User' } },
  ]);
});

test.each([
  ['an enterprise as GitHub describes it, with a slug and no login or type', enterpriseOnGitHub, 'big-co'],
  ['an account with nothing but its id', { id: 7003 }, 'account-7003'],
  ['a Bot', { id: 7004, login: 'dependabot', type: 'Bot' }, 'dependabot'],
  ['a user with no login: refused, since it cannot be told from the rest', { id: 7005, type: 'User' }, 'account-7005'],
])(
  '%s is read as Other, with the name it has or a name made of its id, and nothing else kept',
  async (_name, account, login) => {
    const [read] = await typesOf([account]);
    expect(read?.account).toEqual({ id: account.id, login, type: 'Other' });
  },
);

test('an installation of an enterprise can be asked for by its id, and is Other too', async () => {
  const { client } = clientFixture({
    'GET /app/installations/11': () => json(installationJson(11, { account: enterprise })),
  });
  expect((await client.getInstallation(id(11)))?.account).toEqual({ id: 7001, login: 'big-co', type: 'Other' });
});

test('an account with no numeric id cannot be told apart from another: the answer is refused', async () => {
  const { client } = clientFixture({
    'GET /app/installations': () => json([installationJson(11, { account: { login: 'x' } })]),
  });
  await expect(client.listInstallations()).rejects.toMatchObject({
    name: 'GitHubResponseError',
    paths: ['0.account'],
  });
});
