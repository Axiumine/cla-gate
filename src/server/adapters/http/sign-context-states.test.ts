// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { seedInstant, seedSignatures } from '../../services/export/export-fixture/test-support.ts';
import { sha256 } from '../db/test-support.ts';
import {
  contextOf,
  loginWithEmails,
  publishAndPoint,
  repoIdOf,
  type SignWorld,
  signWorld,
} from './sign-context-fixture/test-support.ts';

// The states of the sign page context (E13-S02): what the signatures of the viewer on the document make of `state`,
// `signature`, `revoked`, `canSign` and `blockedReason`. The pure function behind them is tested in domain/sign-state.test.ts.
// Signatures are stored past the routes with `seedSignatures`, which gives them the instants the test chooses.

const ADA = 1234;
const EMAILS = [{ email: 'ada@example.org', primary: true }];
const MONDAY = 0;
const TUESDAY = 24 * 3_600_000;
const WEDNESDAY = 2 * TUESDAY;
const DAY = TUESDAY;

/** A revocation by the publisher of tenant 1 `afterMs` after the signature was made. */
const revokedAfter = (afterMs: number) => ({ afterMs, byGithubId: 1001, reason: 'maintainer_decision' as const });

/** Stores Ada's signature of the version 1.0 of tenant 1 and answers its id. */
async function adaSigns(world: SignWorld, signedAtMs: number, revoked?: ReturnType<typeof revokedAfter>) {
  const [id] = await seedSignatures(world.db, world.t1, [
    { githubId: ADA, signedAtMs, ...(revoked === undefined ? {} : { revoked }) },
  ]);
  return id;
}

test('a person who signed nothing is ready to sign, with no signature and nothing revoked', async () => {
  const world = await signWorld();
  const context = contextOf(await world.ask(await loginWithEmails(world, ADA, EMAILS), repoIdOf(1)));
  expect(context).toMatchObject({ state: 'ready', signature: null, revoked: null });
});

test('a signature of the active major covers the person: already_signed, with the id, version numbers and instant of it', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  const signatureId = await adaSigns(world, MONDAY);
  const context = contextOf(await world.ask(ada, repoIdOf(1)));
  expect(context.state).toBe('already_signed');
  expect(context.signature).toEqual({
    id: signatureId,
    major: 1,
    minor: 0,
    signedAt: seedInstant(MONDAY).toISOString(),
  });
  expect(context.revoked).toBeNull();
});

test('a minor version does not ask for a new signature: the signature of 1.0 covers the person while 1.1 is in force', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  const signatureId = await adaSigns(world, MONDAY);
  await publishAndPoint(world.db, world.t1, { major: 1, minor: 1, text: 'Terms 1.1' });
  const context = contextOf(await world.ask(ada, repoIdOf(1)));
  expect(context.version).toMatchObject({ major: 1, minor: 1 });
  expect(context.state).toBe('already_signed');
  expect(context.signature).toMatchObject({ id: signatureId, major: 1, minor: 0 });
});

test('a new major version asks for a new signature: resign_required, with the signature that is out of date', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  const signatureId = await adaSigns(world, MONDAY);
  await publishAndPoint(world.db, world.t1, {
    major: 2,
    minor: 0,
    text: 'Terms 2.0',
    rationale: 'Clarified the patent grant',
  });
  const context = contextOf(await world.ask(ada, repoIdOf(1)));
  expect(context.version).toMatchObject({ major: 2, minor: 0, rationale: 'Clarified the patent grant' });
  expect(context.state).toBe('resign_required');
  expect(context.signature).toEqual({
    id: signatureId,
    major: 1,
    minor: 0,
    signedAt: seedInstant(MONDAY).toISOString(),
  });
  expect(context.revoked).toBeNull();
});

test('a person whose only signature was revoked is ready, and the answer says when it was made and revoked', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  await adaSigns(world, MONDAY, revokedAfter(DAY));
  const context = contextOf(await world.ask(ada, repoIdOf(1)));
  expect(context.state).toBe('ready');
  expect(context.signature).toBeNull();
  expect(context.revoked).toEqual({
    major: 1,
    signedAt: seedInstant(MONDAY).toISOString(),
    revokedAt: seedInstant(TUESDAY).toISOString(),
  });
});

test('the answer never names the reason of a revocation or who revoked: not in the revoked entry, not anywhere in the body', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  await adaSigns(world, MONDAY, revokedAfter(DAY));
  const response = await world.ask(ada, repoIdOf(1));
  const body = response.json<{ revoked: Record<string, unknown> }>();
  expect(Object.keys(body.revoked).toSorted((a, b) => a.localeCompare(b))).toEqual(['major', 'revokedAt', 'signedAt']);
  expect(response.body).not.toContain('maintainer_decision');
  expect(response.body).not.toMatch(/revoke_reason|revokeReason|revoked_by|revokedBy|revoker/iu);
});

test('of several revoked signatures the newest one is named, and none is named once the person signs again', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  const third = await publishAndPoint(world.db, world.t1, { major: 3, minor: 0, text: 'Terms 3.0' });
  await seedSignatures(world.db, world.t1, [
    { githubId: ADA, signedAtMs: MONDAY, revoked: revokedAfter(2 * DAY) },
    { githubId: ADA, signedAtMs: TUESDAY, version: third, revoked: revokedAfter(DAY) },
  ]);
  expect(contextOf(await world.ask(ada, repoIdOf(1))).revoked).toEqual({
    major: 3,
    signedAt: seedInstant(TUESDAY).toISOString(),
    revokedAt: seedInstant(WEDNESDAY).toISOString(),
  });
  await seedSignatures(world.db, world.t1, [{ githubId: ADA, signedAtMs: WEDNESDAY, version: third }]);
  const context = contextOf(await world.ask(ada, repoIdOf(1)));
  expect(context).toMatchObject({ state: 'already_signed', revoked: null });
  expect(context.signature).toMatchObject({ major: 3, signedAt: seedInstant(WEDNESDAY).toISOString() });
});

test('only the signatures of the viewer count: the signer of the tenant is already signed and Ada, asking the same, is not', async () => {
  const world = await signWorld();
  await seedSignatures(world.db, world.t1, [{ githubId: 777, signedAtMs: MONDAY }]);
  const ada = await loginWithEmails(world, ADA, EMAILS);
  expect(contextOf(await world.ask(ada, repoIdOf(1))).state).toBe('ready');
  expect(contextOf(await world.ask(await world.login(777), repoIdOf(1))).state).toBe('already_signed');
});

test('a signature on another document of the same tenant does not cover this one', async () => {
  const world = await signWorld();
  const ada = await loginWithEmails(world, ADA, EMAILS);
  const other = await world.db
    .insertInto('cla_documents')
    .values({
      installation_id: world.t1.installationId,
      repository_id: null,
      name: 'Another CLA',
      kind: 'individual',
      active_version_id: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const version = await world.db
    .insertInto('cla_versions')
    .values({
      document_id: other.id,
      major: 1,
      minor: 0,
      content_md: 'Another',
      content_sha256: sha256('Another'),
      published_by: world.t1.publisherId,
      rationale: 'test',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await seedSignatures(
    world.db,
    { ...world.t1, documentId: other.id, versionId: version.id, contentSha256: sha256('Another') },
    [{ githubId: ADA, signedAtMs: MONDAY }],
  );
  expect(contextOf(await world.ask(ada, repoIdOf(1)))).toMatchObject({
    state: 'ready',
    signature: null,
    revoked: null,
  });
});

test('with no verified address the person cannot sign, whatever the state: canSign is false and the reason is no_verified_email', async () => {
  const world = await signWorld();
  const noEmails = await world.login(ADA);
  const ready = contextOf(await world.ask(noEmails, repoIdOf(1)));
  expect(ready).toMatchObject({ state: 'ready', emails: [], canSign: false, blockedReason: 'no_verified_email' });
  await adaSigns(world, MONDAY);
  expect(contextOf(await world.ask(noEmails, repoIdOf(1)))).toMatchObject({
    state: 'already_signed',
    canSign: false,
    blockedReason: 'no_verified_email',
  });
});

test('with a verified address the person can sign and nothing blocks them; the addresses are the ones of the session, as stored', async () => {
  const world = await signWorld();
  const emails = [
    { email: 'Ada@Example.ORG', primary: false },
    { email: 'ada@example.net', primary: true },
  ];
  const context = contextOf(await world.ask(await loginWithEmails(world, ADA, emails), repoIdOf(1)));
  expect(context).toMatchObject({ emails, canSign: true, blockedReason: null });
});

test('the addresses come from the session of the request: another session of the same person has its own', async () => {
  const world = await signWorld();
  const first = await loginWithEmails(world, ADA, [{ email: 'first@example.org', primary: true }]);
  const second = await loginWithEmails(world, ADA, [{ email: 'second@example.org', primary: true }]);
  expect(contextOf(await world.ask(first, repoIdOf(1))).emails).toEqual([
    { email: 'first@example.org', primary: true },
  ]);
  expect(contextOf(await world.ask(second, repoIdOf(1))).emails).toEqual([
    { email: 'second@example.org', primary: true },
  ]);
});
