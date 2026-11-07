// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { MAX_ORG_CHECKS } from '../../services/corporate-claim-match.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import { stateOf } from './corporate-approval-fixture/test-support.ts';
import {
  ACME_EMAIL,
  ACME_ORG,
  approveDomain,
  approveOrg,
  askedOf,
  claimAs,
  claimOf,
  claimWorld,
  employee,
  loginOf,
  seedOrgApprovals,
  userApprovalsOf,
} from './corporate-claim-fixture/test-support.ts';
import { corporateWorld, failureOf, signAs, signerWith } from './corporate-fixture/test-support.ts';

// What GitHub can do to a claim (E21-S04): the account of the person, the organisation and the membership are asked on the installation of the
// tenant, and whatever fails (a rate limit, a refusal, an outage, a body that is not what GitHub sends) is a `503 upstream_unavailable` with
// GitHub's wait when it gave one, and nothing written. A domain match never asks GitHub, so it works when GitHub does not.

const EMMA = 7101;
const ROUTE = 'GET /orgs/{org}/public_members/{username}';

test.each([
  ['a rate limit, with the wait GitHub asked for', new GitHubRateLimitedError(120, 'primary'), '120'],
  ['a rate limit with a very long wait, capped at 5 minutes', new GitHubRateLimitedError(100_000, 'secondary'), '300'],
  ['a refusal (403)', new GitHubForbiddenError(ROUTE), undefined],
  ['an outage (5xx)', new GitHubUnavailableError('GitHub answered 500'), undefined],
  ['a body that is not what GitHub sends', new GitHubResponseError(ROUTE, []), undefined],
  ['a rejected App credential', new GitHubAuthError(), undefined],
  ['a failure nobody foresaw', new Error('zzzz-detail'), undefined],
] as const)(
  '%s on the check of the membership is a 503 upstream_unavailable with no row, and a retry works',
  async (_label, error, wait) => {
    const world = await claimWorld();
    await approveOrg(world, 'acme-org');
    world.github.scriptPublicMember(ACME_ORG.login, loginOf(EMMA), true);
    const emma = await employee(world, EMMA, []);
    const before = await stateOf(world.db);
    world.github.failNext('isPublicOrgMember', error);
    const failed = await claimAs(world, emma, world.t1.plain.githubRepoId);
    expect(failureOf(failed)).toEqual([503, 'upstream_unavailable']);
    expect(failed.headers['retry-after']).toBe(wait);
    expect(failed.body).not.toContain('zzzz');
    expect(await stateOf(world.db)).toEqual(before);
    expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  },
);

test.each([
  { method: 'getUserAccount', what: 'the account of the person' },
  { method: 'getOrganizationAccount', what: 'the organisation' },
] as const)(
  "a failure of the lookup of $what ($method) is a 503 upstream_unavailable with GitHub's wait and no row",
  async ({ method }) => {
    const world = await claimWorld();
    await approveOrg(world, 'acme-org');
    world.github.scriptPublicMember(ACME_ORG.login, loginOf(EMMA), true);
    const emma = await employee(world, EMMA, []);
    const before = await stateOf(world.db);
    world.github.failNext(method, new GitHubRateLimitedError(45, 'secondary'));
    const failed = await claimAs(world, emma, world.t1.plain.githubRepoId);
    expect(failureOf(failed)).toEqual([503, 'upstream_unavailable']);
    expect(failed.headers['retry-after']).toBe('45');
    expect(await stateOf(world.db)).toEqual(before);
  },
);

test('a domain match asks GitHub nothing, so it covers the person while GitHub is down; a server with no GitHub App still answers it', async () => {
  const world = await claimWorld();
  await approveDomain(world, 'acme.example');
  const emma = await employee(world, EMMA);
  world.github.failNext('getUserAccount', new GitHubUnavailableError('down'));
  world.github.failNext('isPublicOrgMember', new GitHubUnavailableError('down'));
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const blind = await corporateWorld();
  const adas = await signAs(blind, blind.ada, blind.c1);
  const added = await blind.app.inject({
    method: 'POST',
    url: `/api/corporate/agreements/${adas.id}/approvals`,
    headers: { ...blind.ada.headers, 'content-type': 'application/json' },
    payload: JSON.stringify({ kind: 'email_domain', domain: 'acme.example' }),
  });
  expect(added.statusCode).toBe(201);
  const person = await signerWith(blind, EMMA, [ACME_EMAIL]);
  expect(claimOf(await claimAs(blind, person, blind.t1.plain.githubRepoId))).toEqual([201, 'covered']);
});

test('a server with no GitHub App cannot check a membership: 503 upstream_unavailable, nothing written', async () => {
  const world = await corporateWorld();
  const adas = await signAs(world, world.ada, world.c1);
  await world.db
    .insertInto('corporate_approvals')
    .values({
      installation_id: world.t1.installationId,
      agreement_id: adas.id,
      kind: 'github_org',
      subject_github_id: ACME_ORG.id,
      source: 'manager',
      approved_by: world.ada.userId,
    })
    .execute();
  const row = await world.db
    .selectFrom('corporate_approvals')
    .select('id')
    .where('kind', '=', 'github_org')
    .executeTakeFirstOrThrow();
  await world.db.insertInto('corporate_approval_pii').values({ approval_id: row.id, login: ACME_ORG.login }).execute();
  const person = await signerWith(world, EMMA, []);
  const before = await stateOf(world.db);
  expect(failureOf(await claimAs(world, person, world.t1.plain.githubRepoId))).toEqual([503, 'upstream_unavailable']);
  expect(await stateOf(world.db)).toEqual(before);
});

test('an organisation approval that holds no login is passed over without a call to GitHub', async () => {
  const world = await claimWorld();
  await seedOrgApprovals(world, { count: 1, withLogin: false });
  const emma = await employee(world, EMMA, []);
  const before = askedOf(world).length;
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(askedOf(world)).toHaveLength(before);
});

test('a claim checks at most 25 organisations, in the order of their approvals, however many the manager approved', async () => {
  const world = await claimWorld();
  await seedOrgApprovals(world, { count: MAX_ORG_CHECKS + 5, withLogin: true });
  const emma = await employee(world, EMMA, []);
  const orgLogin = (position: number) => `org-${position}`;
  world.github.scriptPublicMember(orgLogin(MAX_ORG_CHECKS + 1), loginOf(EMMA), true);
  const before = askedOf(world).length;
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  const methods = askedOf(world)
    .slice(before)
    .map(([method]) => method);
  expect(methods.filter((method) => method === 'isPublicOrgMember')).toHaveLength(MAX_ORG_CHECKS);
  expect(methods.filter((method) => method === 'getUserAccount')).toHaveLength(1);
  world.github.scriptPublicMember(orgLogin(MAX_ORG_CHECKS), loginOf(EMMA), true);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  expect(await userApprovalsOf(world.db, EMMA)).toHaveLength(1);
  expect(parseGithubId(EMMA)).toBe(EMMA);
});
