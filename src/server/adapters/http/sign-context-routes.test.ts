// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { fakeEnqueuer } from '../../services/jobs-fixture/test-support.ts';
import { tenantChecksums } from '../db/tenant-fixture/test-support.ts';
import {
  contextOf,
  errorCodeOf,
  loginWithEmails,
  publishAndPoint,
  repoIdOf,
  signWorld,
  withoutRequestId,
} from './sign-context-fixture/test-support.ts';

// `GET /api/sign/:githubRepoId` (E13-S02): the request (path and query), who may ask, what the answer is for a repository the
// instance does not serve or that has no CLA in force, and that the read writes nothing. The states the viewer can be in are in
// sign-context-states.test.ts and the isolation of the tenants in sign-context-tenants.test.ts.

const ADA = 1234;
/** `expect.stringMatching` and `expect.stringContaining` are typed `any`; as `unknown` they can sit in an object literal. */
const MILLISECOND_INSTANT: unknown = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
const CONSENT_SENTENCE: unknown = expect.stringContaining(
  'I have read the Contributor License Agreement version shown on this page',
);
const EMAILS = [
  { email: 'ada@example.org', primary: true },
  { email: 'Ada.Lovelace@Example.ORG', primary: false },
];

test('a signed-in person gets the context of a repository: the answer is never cached and holds the fields of the story', async () => {
  const world = await signWorld();
  const session = await loginWithEmails(world, ADA, EMAILS);
  const response = await world.ask(session, repoIdOf(1), '?pr=45');
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['content-type']).toContain('application/json');
  expect(contextOf(response)).toEqual({
    repository: { githubRepoId: repoIdOf(1), fullName: 'org-1/repo', accountLogin: 'org-1' },
    document: { id: world.t1.documentId, name: 'Individual CLA' },
    version: {
      id: world.t1.versionId,
      major: 1,
      minor: 0,
      contentMd: 'I grant the project a perpetual licence to my contributions.',
      contentSha256: world.t1.contentSha256,
      rationale: 'test',
      publishedAt: MILLISECOND_INSTANT,
    },
    consent: { id: 'individual-v1', text: CONSENT_SENTENCE },
    emails: EMAILS,
    viewer: { githubId: ADA, login: `login-${ADA}` },
    pr: 45,
    prUrl: 'https://github.com/org-1/repo/pull/45',
    state: 'ready',
    signature: null,
    revoked: null,
    canSign: true,
    blockedReason: null,
  });
});

test('the version is the stored source text and is not rendered: Markdown and markup come back as they were written', async () => {
  const world = await signWorld();
  const text = '# Terms\n\n* one <b>two</b> [three](https://example.org)\n';
  const published = await publishAndPoint(world.db, world.t1, {
    major: 2,
    minor: 0,
    text,
    rationale: 'Clarified the patent grant',
  });
  const session = await world.login(ADA);
  const { version } = contextOf(await world.ask(session, repoIdOf(1)));
  expect(version).toMatchObject({
    id: published.id,
    major: 2,
    contentMd: text,
    contentSha256: published.sha256,
    rationale: 'Clarified the patent grant',
  });
});

test('without the pr parameter pr and prUrl are null, and the url is built from the full name of the snapshot', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  expect(contextOf(await world.ask(session, repoIdOf(1)))).toMatchObject({ pr: null, prUrl: null });
  await world.db
    .updateTable('repositories')
    .set({ full_name: 'renamed-org/renamed.repo' })
    .where('id', '=', world.t1.repositoryId)
    .execute();
  expect(contextOf(await world.ask(session, repoIdOf(1), '?pr=7'))).toMatchObject({
    repository: { fullName: 'renamed-org/renamed.repo' },
    pr: 7,
    prUrl: 'https://github.com/renamed-org/renamed.repo/pull/7',
  });
});

test('a full name that is not an owner and a name is put into no address', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  await world.db
    .updateTable('repositories')
    .set({ full_name: 'evil.example/../x?y#z' })
    .where('id', '=', world.t1.repositoryId)
    .execute();
  expect(contextOf(await world.ask(session, repoIdOf(1), '?pr=7'))).toMatchObject({ pr: 7, prUrl: null });
});

test('the largest pull request number is accepted', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  expect(contextOf(await world.ask(session, repoIdOf(1), '?pr=2147483647'))).toMatchObject({
    pr: 2_147_483_647,
    prUrl: 'https://github.com/org-1/repo/pull/2147483647',
  });
});

test('a request with no session is a 401 with the standard body, never a redirect, whatever the repository', async () => {
  const world = await signWorld();
  for (const githubRepoId of [repoIdOf(1), 987_654]) {
    const response = await world.ask(null, githubRepoId, '?pr=45');
    expect(response.statusCode).toBe(401);
    expect(errorCodeOf(response)).toBe('unauthorized');
    expect(response.headers.location).toBeUndefined();
  }
});

test('a session cookie that is not live is a 401 as well', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  world.advance(30 * 24 * 3600);
  const response = await world.ask(session, repoIdOf(1));
  expect(response.statusCode).toBe(401);
  expect(response.headers.location).toBeUndefined();
});

test.each([
  ['zero', '0'],
  ['negative', '-1'],
  ['letters', 'abc'],
  ['a decimal', '1.5'],
  ['a leading zero', '09000'],
  ['an exponent', '9e3'],
  ['a hex number', '0x10'],
  ['a plus sign', '+9000'],
  ['a space', '%209000'],
  ['more than a safe integer holds', '9007199254740993'],
  ['a long run of digits', '9'.repeat(30)],
])('a repository id that is %s is a 400 with the standard error body', async (_what, githubRepoId) => {
  const world = await signWorld();
  const session = await world.login(ADA);
  const response = await world.ask(session, githubRepoId);
  expect(response.statusCode).toBe(400);
  expect(errorCodeOf(response)).toBe('bad_request');
});

test.each([
  ['zero', '?pr=0'],
  ['negative', '?pr=-1'],
  ['one more than the largest', '?pr=2147483648'],
  ['letters', '?pr=abc'],
  ['a decimal', '?pr=1.5'],
  ['a leading zero', '?pr=045'],
  ['an exponent', '?pr=1e3'],
  ['empty', '?pr='],
  ['given twice', '?pr=1&pr=2'],
  ['a key the route does not know', '?pr=1&x=1'],
  ['a key that names a person', '?githubId=2'],
])('a query string with a pr that is %s is a 400 with the standard error body', async (_what, query) => {
  const world = await signWorld();
  const session = await world.login(ADA);
  const response = await world.ask(session, repoIdOf(1), query);
  expect(response.statusCode).toBe(400);
  expect(errorCodeOf(response)).toBe('bad_request');
});

test('the 400 answers do not echo the request: the value that failed is nowhere in the body', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  const response = await world.ask(session, repoIdOf(1), '?pr=zzzzmarker');
  expect(response.statusCode).toBe(400);
  expect(response.body).not.toContain('zzzzmarker');
});

test('a repository the instance does not know and one of an installation it does not serve are the same 404, byte for byte', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  const unknown = await world.ask(session, 987_654);
  expect(unknown.statusCode).toBe(404);
  expect(errorCodeOf(unknown)).toBe('not_found');
  const away = [
    ['rejected by the admission policy', { admission_status: 'rejected', admission_reason: 'policy_changed' }],
    ['suspended', { suspended_at: new Date('2026-10-01T00:00:00Z') }],
    ['uninstalled', { deleted_at: new Date('2026-10-01T00:00:00Z') }],
  ] as const;
  for (const [what, columns] of away) {
    await world.db.updateTable('installations').set(columns).where('id', '=', world.t1.installationId).execute();
    const response = await world.ask(session, repoIdOf(1));
    expect(response.statusCode, what).toBe(404);
    expect(withoutRequestId(response), what).toBe(withoutRequestId(unknown));
    await world.db
      .updateTable('installations')
      .set({ admission_status: 'admitted', admission_reason: null, suspended_at: null, deleted_at: null })
      .where('id', '=', world.t1.installationId)
      .execute();
  }
  expect((await world.ask(session, repoIdOf(1))).statusCode).toBe(200);
});

test('a repository that GitHub no longer lists for its installation is the same 404 as an unknown one', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  const unknown = await world.ask(session, 987_654);
  await world.db
    .updateTable('repositories')
    .set({ removed_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.repositoryId)
    .execute();
  const removed = await world.ask(session, repoIdOf(1));
  expect(removed.statusCode).toBe(404);
  expect(withoutRequestId(removed)).toBe(withoutRequestId(unknown));
});

test('a repository with no document, and one whose document has no active version, are a 409 no_active_cla', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  await world.db
    .updateTable('cla_documents')
    .set({ active_version_id: null })
    .where('id', '=', world.t1.documentId)
    .execute();
  const noVersion = await world.ask(session, repoIdOf(1));
  expect([noVersion.statusCode, errorCodeOf(noVersion)]).toEqual([409, 'no_active_cla']);
  expect(noVersion.headers['cache-control']).toBe('no-store');
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: null })
    .where('id', '=', world.t1.repositoryId)
    .execute();
  const noDocument = await world.ask(session, repoIdOf(1));
  expect([noDocument.statusCode, errorCodeOf(noDocument)]).toEqual([409, 'no_active_cla']);
  expect(withoutRequestId(noDocument)).toBe(withoutRequestId(noVersion));
});

test('enforcement does not have to be on: a repository that was disabled later still shows the document attached to it', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  await world.db.updateTable('repositories').set({ enabled: false }).where('id', '=', world.t1.repositoryId).execute();
  expect(contextOf(await world.ask(session, repoIdOf(1))).document.id).toBe(world.t1.documentId);
  await world.db.updateTable('repositories').set({ enabled: true }).where('id', '=', world.t1.repositoryId).execute();
  expect(contextOf(await world.ask(session, repoIdOf(1))).document.id).toBe(world.t1.documentId);
});

test('the read writes nothing: no statement but a select runs, no tenant row, no audit entry and no job changes', async () => {
  const enqueuer = fakeEnqueuer();
  const world = await signWorld({}, { enqueuer });
  const session = await loginWithEmails(world, ADA, EMAILS);
  const before = await tenantChecksums(world.db);
  const statements = world.queries.length;
  expect(contextOf(await world.ask(session, repoIdOf(1), '?pr=45')).state).toBe('ready');
  expect(contextOf(await world.ask(session, repoIdOf(1))).state).toBe('ready');
  expect(await tenantChecksums(world.db)).toEqual(before);
  expect(new Set(world.queries.slice(statements))).toEqual(new Set(['SelectQueryNode']));
  const audit = await world.db
    .selectFrom('audit_log')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  expect(audit.n).toBe(0);
  expect(enqueuer.calls).toEqual([]);
});

test('only GET answers: HEAD, POST and the other methods are not served', async () => {
  const world = await signWorld();
  const session = await world.login(ADA);
  const head = await world.app.inject({
    method: 'HEAD',
    url: `/api/sign/${repoIdOf(1)}`,
    headers: { cookie: session.cookie },
  });
  const post = await world.app.inject({
    method: 'POST',
    url: `/api/sign/${repoIdOf(1)}`,
    payload: {},
    headers: { cookie: session.cookie, origin: world.origin },
  });
  expect([head.statusCode, post.statusCode]).toEqual([404, 404]);
});
