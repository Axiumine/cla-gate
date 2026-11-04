// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import { type TenantWorld, twoTenants } from '../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase, publishVersion } from '../adapters/db/test-support.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';
import { LoginCache } from './public-login-cache.ts';
import {
  type PublicVerdict,
  PublicVerificationUnavailableError,
  publicGitHubNotWired,
  verifySigner,
} from './public-verification.ts';
import { FakeClock, FakeGitHub } from './test-support.ts';

// The check of E22-S02, the one function every public route asks: what it answers for each state of the repository, the installation and
// the login, and what it asks GitHub. The routes are tested on top of it in public-verification-routes*.test.ts.

const SIGNED: PublicVerdict = { kind: 'verdict', signed: true };
const UNSIGNED: PublicVerdict = { kind: 'verdict', signed: false };
const NOT_FOUND: PublicVerdict = { kind: 'not_found' };

/** Two tenants on PGlite; the plain repository of tenant 1 enforces its published document and is opted in, and its signer is `octocat` on a GitHub in memory. */
async function world() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  const { t1, t2 } = tenants;
  const github = new FakeGitHub();
  for (const tenant of [t1, t2]) {
    const account = { id: tenant.accountId, login: tenant.accountLogin, type: 'Organization' } as const;
    github.addInstallation({ id: tenant.githubInstallationId, account, suspendedAt: null, permissions: {} });
  }
  github.scriptUserAccount('octocat', { id: t1.signer.githubId, login: 'octocat', type: 'User' });
  github.scriptUserAccount('hubot', { id: t2.signer.githubId, login: 'hubot', type: 'User' });
  github.scriptUserAccount('stranger', { id: parseGithubId(7_000_001), login: 'stranger', type: 'User' });
  await db
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: t1.documentId, public_verification: true })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  const clock = new FakeClock('2026-11-01T10:00:00Z');
  const deps = { db, github, logins: new LoginCache(clock) };
  const ask = (login: string, tenant: TenantWorld = t1) =>
    verifySigner(deps, { githubRepoId: tenant.plain.githubRepoId, login });
  return { db, github, clock, deps, ask, ...tenants };
}

test('a login whose numeric id has an unrevoked individual signature at the active major is signed, whatever the case it is spelled in', async () => {
  const { ask } = await world();
  expect(await ask('octocat')).toEqual(SIGNED);
  expect(await ask('OctoCat')).toEqual(SIGNED);
  expect(await ask('OCTOCAT')).toEqual(SIGNED);
});

test('the four false cases are one verdict: never signed, revoked, an older major, and a login nobody has', async () => {
  const { ask, db, t1, github } = await world();
  expect(await ask('stranger')).toEqual(UNSIGNED);
  expect(await ask('nobody-has-this')).toEqual(UNSIGNED);
  await db
    .updateTable('signatures')
    .set({ revoked_at: new Date(), revoked_by: t1.publisherId, revoke_reason: 'maintainer_decision' })
    .where('id', '=', t1.signatureId)
    .execute();
  expect(await ask('octocat')).toEqual(UNSIGNED);
  expect(github.calls.map((call) => call.method)).toEqual(['getUserAccount', 'getUserAccount', 'getUserAccount']);
});

test('a signature of an older major no longer counts once the document has moved to a new one', async () => {
  const { ask, db, t1 } = await world();
  expect(await ask('octocat')).toEqual(SIGNED);
  const second = await publishVersion(db, t1.documentId, t1.publisherId, { major: 2, minor: 0, text: 'Second terms' });
  await db.updateTable('cla_documents').set({ active_version_id: second.id }).where('id', '=', t1.documentId).execute();
  expect(await ask('octocat')).toEqual(UNSIGNED);
});

test('the numeric id decides and the stored login does not: a person who signed under another login is signed under the one GitHub gives now', async () => {
  const { ask, db, t1, github } = await world();
  await db.updateTable('users').set({ login: 'old-name' }).where('id', '=', t1.signer.userId).execute();
  github.scriptUserAccount('new-name', { id: t1.signer.githubId, login: 'new-name', type: 'User' });
  expect(await ask('new-name')).toEqual(SIGNED);
  expect(await ask('old-name')).toEqual(UNSIGNED);
});

test('an unknown repository is not found, and GitHub is not asked', async () => {
  const { deps, github } = await world();
  expect(await verifySigner(deps, { githubRepoId: parseGithubId(987_654), login: 'octocat' })).toEqual(NOT_FOUND);
  expect(github.calls).toEqual([]);
});

test.each([
  ['not enforcing', { enabled: false }],
  ['not opted in by the maintainers', { public_verification: false }],
])('a repository that is %s is not found, and GitHub is not asked', async (_name, change) => {
  const { db, ask, t1, github } = await world();
  await db.updateTable('repositories').set(change).where('id', '=', t1.plain.repositoryId).execute();
  expect(await ask('octocat')).toEqual(NOT_FOUND);
  expect(github.calls).toEqual([]);
});

test.each([
  ['suspended', { suspended_at: new Date('2026-10-01T00:00:00Z') }],
  ['uninstalled', { deleted_at: new Date('2026-10-01T00:00:00Z') }],
  ['rejected', { admission_status: 'rejected' as const, admission_reason: 'policy_changed' as const }],
])('a repository whose installation is %s is not found, and GitHub is not asked', async (_name, change) => {
  const { db, ask, t1, github } = await world();
  await db.updateTable('installations').set(change).where('id', '=', t1.installationId).execute();
  expect(await ask('octocat')).toEqual(NOT_FOUND);
  expect(github.calls).toEqual([]);
});

test('a repository that was removed from its installation is not found', async () => {
  const { db, ask, t1 } = await world();
  await db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', t1.plain.repositoryId)
    .execute();
  expect(await ask('octocat')).toEqual(NOT_FOUND);
});

test('a suspended installation turns an answer that was true into not found, and lifting it turns it back', async () => {
  const { db, ask, t1 } = await world();
  expect(await ask('octocat')).toEqual(SIGNED);
  await db.updateTable('installations').set({ suspended_at: new Date() }).where('id', '=', t1.installationId).execute();
  expect(await ask('octocat')).toEqual(NOT_FOUND);
  await db.updateTable('installations').set({ suspended_at: null }).where('id', '=', t1.installationId).execute();
  expect(await ask('octocat')).toEqual(SIGNED);
});

test('a repository with no document to enforce has no signers, and GitHub is not asked', async () => {
  const { db, ask, t1, github } = await world();
  await db.updateTable('repositories').set({ cla_document_id: null }).where('id', '=', t1.plain.repositoryId).execute();
  expect(await ask('octocat')).toEqual(UNSIGNED);
  expect(github.calls).toEqual([]);
});

test('the login is looked up with the token of the installation that holds the repository, and the signature is looked for in that tenant only', async () => {
  const { db, ask, t1, t2, github } = await world();
  await db
    .updateTable('repositories')
    .set({ enabled: true, cla_document_id: t2.documentId, public_verification: true })
    .where('id', '=', t2.plain.repositoryId)
    .execute();
  expect(await ask('hubot', t2)).toEqual(SIGNED);
  expect(await ask('octocat', t2)).toEqual(UNSIGNED);
  expect(await ask('hubot', t1)).toEqual(UNSIGNED);
  expect(await ask('octocat', t1)).toEqual(SIGNED);
  expect(github.calls.map((call) => call.installationId)).toEqual([t2.githubInstallationId, t2.githubInstallationId]);
});

test('GitHub is asked once for a login in ten minutes, a login nobody has included, and again after that', async () => {
  const { ask, clock, github } = await world();
  await ask('octocat');
  await ask('OctoCat');
  await ask('nobody-has-this');
  await ask('nobody-has-this');
  expect(github.calls).toHaveLength(2);
  clock.advance(599_000);
  await ask('octocat');
  expect(github.calls).toHaveLength(2);
  clock.advance(2_000);
  await ask('octocat');
  await ask('nobody-has-this');
  expect(github.calls).toHaveLength(4);
});

test('a cached login is not a cached answer: the signature is read again on every call', async () => {
  const { ask, db, t1, github } = await world();
  expect(await ask('octocat')).toEqual(SIGNED);
  await db
    .updateTable('signatures')
    .set({ revoked_at: new Date(), revoked_by: t1.publisherId, revoke_reason: 'maintainer_decision' })
    .where('id', '=', t1.signatureId)
    .execute();
  expect(await ask('octocat')).toEqual(UNSIGNED);
  expect(github.calls).toHaveLength(1);
});

test.each([
  ['rate_limited', 120],
  ['unavailable', 30],
  ['malformed', 30],
] as const)(
  'a login GitHub answers "%s" for is an outage that says to wait %i seconds, and it is not remembered',
  async (failure, wait) => {
    const { ask, github } = await world();
    github.scriptUserAccount('flaky', failure);
    const error = await ask('flaky').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PublicVerificationUnavailableError);
    expect(error).toMatchObject({ retryAfterSeconds: wait, message: 'GitHub could not tell who the login is' });
    github.scriptUserAccount('flaky', { id: parseGithubId(7_000_002), login: 'flaky', type: 'User' });
    expect(await ask('flaky')).toEqual(UNSIGNED);
    expect(github.calls).toHaveLength(2);
  },
);

test.each([
  ['a limit of a day', new GitHubRateLimitedError(86_400, 'primary'), 300],
  ['a limit of exactly the ceiling', new GitHubRateLimitedError(300, 'secondary'), 300],
  ['a limit of a second', new GitHubRateLimitedError(1, 'secondary'), 1],
  ['a refusal', new GitHubUnavailableError('GitHub answered 403 to GET /users/{username}'), 30],
  ['an error that is not GitHub', new Error('socket hang up'), 30],
])(
  '%s tells the client to wait %i seconds at most, in a message with nothing of the login in it',
  async (_name, failure, wait) => {
    const { ask, github } = await world();
    github.failNext('getUserAccount', failure);
    const error = await ask('secret-login-zzzz').catch((caught: unknown) => caught);
    expect(error).toMatchObject({ name: 'PublicVerificationUnavailableError', retryAfterSeconds: wait });
    expect(String(error)).not.toContain('zzzz');
  },
);

test('a server with no GitHub App fails every lookup as an outage, and still answers for the repositories it can settle without one', async () => {
  const { deps, t1, db } = await world();
  const unwired = { ...deps, github: publicGitHubNotWired };
  const error = await verifySigner(unwired, { githubRepoId: t1.plain.githubRepoId, login: 'octocat' }).catch(
    (caught: unknown) => caught,
  );
  expect(error).toMatchObject({ name: 'PublicVerificationUnavailableError', retryAfterSeconds: 30 });
  await db.updateTable('repositories').set({ enabled: false }).where('id', '=', t1.plain.repositoryId).execute();
  expect(await verifySigner(unwired, { githubRepoId: t1.plain.githubRepoId, login: 'octocat' })).toEqual(NOT_FOUND);
});
