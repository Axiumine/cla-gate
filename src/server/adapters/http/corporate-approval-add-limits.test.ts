// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { APPROVAL_LIMIT } from '../../../shared/corporate-approvals.ts';
import {
  GitHubAuthError,
  GitHubForbiddenError,
  GitHubNotFoundError,
  GitHubRateLimitedError,
  GitHubResponseError,
  GitHubUnavailableError,
} from '../../services/ports/github-errors.ts';
import {
  type ApprovalWorld,
  addAs,
  addedOf,
  approvalWorld,
  revokeAs,
  revokeSignature,
  seedUserApprovals,
  stateOf,
  storedApprovals,
  suspendTenantOne,
} from './corporate-approval-fixture/test-support.ts';
import { corporateWorld, detailsOf, failureOf, signAs } from './corporate-fixture/test-support.ts';

// What stands between a valid request and a stored approval (E21-S03): the answers of GitHub, which are all `503 upstream_unavailable`
// whatever they are (a rate limit carries GitHub's wait, capped), the limit of 500 approvals in force, a revoked agreement and a
// suspended tenant. Whatever fails, no row is written.

const ROUTE = 'GET /users/{username}';

/** Ada's own approval and 498 more of the manager, stored past the routes: 499 are in force, one place is left. */
function seedAlmostFull(world: ApprovalWorld): Promise<void> {
  return seedUserApprovals(
    world.db,
    { installationId: world.t1.installationId, agreementId: world.adas.id, userId: world.ada.userId },
    APPROVAL_LIMIT - 2,
  );
}

test.each([
  ['a rate limit, with the wait GitHub asked for', new GitHubRateLimitedError(120, 'primary'), '120'],
  ['a rate limit with a very long wait, capped at 5 minutes', new GitHubRateLimitedError(100_000, 'secondary'), '300'],
  ['a refusal (403)', new GitHubForbiddenError(ROUTE), undefined],
  ['a 404 on a route that should not give one', new GitHubNotFoundError(ROUTE), undefined],
  ['an outage (5xx)', new GitHubUnavailableError('GitHub answered 500'), undefined],
  ['a body that is not an account', new GitHubResponseError(ROUTE, []), undefined],
  ['a rejected App credential', new GitHubAuthError(), undefined],
  ['a failure nobody foresaw', new Error('zzzz-detail'), undefined],
] as const)(
  '%s on the lookup of a login is a 503 upstream_unavailable, with no row, and a retry works',
  async (_label, error, wait) => {
    const world = await approvalWorld();
    const before = await stateOf(world.db);
    world.github.failNext('getUserAccount', error);
    const failed = await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' });
    expect(failureOf(failed)).toEqual([503, 'upstream_unavailable']);
    expect(failed.headers['retry-after']).toBe(wait);
    expect(failed.body).not.toContain('zzzz');
    expect(await stateOf(world.db)).toEqual(before);
    expect(addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' })).githubId).toBe(
      7001,
    );
  },
);

test('a failure of the lookup of an organisation is a 503 upstream_unavailable too, with GitHub’s wait and no row', async () => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  world.github.failNext('getOrganizationAccount', new GitHubRateLimitedError(45, 'secondary'));
  const failed = await addAs(world, world.ada, world.adas.id, { kind: 'github_org', login: 'acme-org' });
  expect(failureOf(failed)).toEqual([503, 'upstream_unavailable']);
  expect(failed.headers['retry-after']).toBe('45');
  expect(await stateOf(world.db)).toEqual(before);
});

test('a server with no GitHub App cannot look an account up: 503 upstream_unavailable, while a domain needs no lookup', async () => {
  const world = await corporateWorld();
  const adas = await signAs(world, world.ada, world.c1);
  const before = await stateOf(world.db);
  const blind = await addAs(world, world.ada, adas.id, { kind: 'github_org', login: 'acme-org' });
  expect(failureOf(blind)).toEqual([503, 'upstream_unavailable']);
  expect(await stateOf(world.db)).toEqual(before);
  expect((await addAs(world, world.ada, adas.id, { kind: 'email_domain', domain: 'acme.com' })).statusCode).toBe(201);
});

test('the agreement is revoked while GitHub is being asked: the lock finds it, 409 agreement_revoked, no row', async () => {
  const world = await approvalWorld();
  const before = await stateOf(world.db);
  world.github.beforeNext('getUserAccount', () => revokeSignature(world, world.adas.signatureId));
  const response = await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' });
  expect(failureOf(response)).toEqual([409, 'agreement_revoked']);
  expect(await stateOf(world.db)).toEqual(before);
});

test('500 approvals in force fit, the 501st is a 422 approval_limit that names the limit, and a revocation makes room', async () => {
  const world = await approvalWorld();
  // Ada's own approval and 498 more are 499 in force: one more fits.
  await seedAlmostFull(world);
  const last = addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'acme.com' }));
  const before = await stateOf(world.db);
  const over = await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' });
  expect(failureOf(over)).toEqual([422, 'approval_limit']);
  expect(detailsOf(over)).toEqual({ limit: APPROVAL_LIMIT });
  expect(await stateOf(world.db)).toEqual(before);
  expect((await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: last.id })).statusCode).toBe(200);
  expect(addedOf(await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' })).githubId).toBe(
    7001,
  );
});

test('two requests that race for the last place: one is stored, the other is a 422 approval_limit', async () => {
  const world = await approvalWorld();
  await seedAlmostFull(world);
  const answers = await Promise.all([
    addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'one.example' }),
    addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'two.example' }),
  ]);
  expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([201, 422]);
  const active = (await storedApprovals(world.db, world.adas.id)).filter((row) => row.revoked_at === null);
  expect(active).toHaveLength(APPROVAL_LIMIT);
});

test('a revoked agreement cannot be changed: 409 agreement_revoked, before anything is looked up', async () => {
  const world = await approvalWorld();
  await revokeSignature(world, world.adas.signatureId);
  const before = await stateOf(world.db);
  const response = await addAs(world, world.ada, world.adas.id, { kind: 'user', login: 'jane-doe' });
  expect(failureOf(response)).toEqual([409, 'agreement_revoked']);
  expect(world.github.calls).toEqual([]);
  expect(await stateOf(world.db)).toEqual(before);
});

test('a suspended installation cannot be changed: 409 installation_suspended, before anything is looked up', async () => {
  const world = await approvalWorld();
  await suspendTenantOne(world);
  const before = await stateOf(world.db);
  const response = await addAs(world, world.ada, world.adas.id, { kind: 'email_domain', domain: 'acme.com' });
  expect(failureOf(response)).toEqual([409, 'installation_suspended']);
  expect(world.github.calls).toEqual([]);
  expect(await stateOf(world.db)).toEqual(before);
});
