// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { SIGN_REFUSAL_STATUS } from '../../../shared/sign.ts';
import { SIGNER_RULE_STATUS } from '../../../shared/signer-input.ts';
import { withoutRequestId } from './sign-context-fixture/test-support.ts';
import {
  ADA_EMAIL,
  bodyFor,
  enforceCorporateDocument,
  NOTHING_WRITTEN,
  postSign,
  publishNext,
  signerWith,
  signingWorld,
  writtenRows,
} from './sign-fixture/test-support.ts';

// The checks of the sign request after the body was read (E13-S04), in the order the story fixes: the repository and its tenant,
// a CLA in force, the version, its hash, the consent sentence, the kind of the document, then the name and the address. Every
// refusal is the standard error body, never echoes what the person typed, and writes nothing.

/** U+202E, the right-to-left override. */
const RLO = String.fromCodePoint(0x202e);

type World = Awaited<ReturnType<typeof signingWorld>>['world'];
type Ada = Awaited<ReturnType<typeof signingWorld>>['ada'];

/** Sends `body`, expects the refusal `[status, code]`, and checks that no row was written. Answers the error body. */
async function refused(world: World, ada: Ada, body: unknown, expected: readonly [status: number, code: string]) {
  const response = await postSign(world, ada, body);
  const { error } = errorResponseSchema.parse(response.json());
  expect([response.statusCode, error.code]).toEqual(expected);
  expect(await writtenRows(world.db)).toEqual(NOTHING_WRITTEN);
  return { error, text: withoutRequestId(response) };
}

test('an unknown repository is a 404', async () => {
  const { world, ada, body } = await signingWorld();
  await refused(world, ada, body({ githubRepoId: 987_654 }), [404, 'not_found']);
});

test.each([
  ['a suspended installation', { suspended_at: new Date('2026-10-01T00:00:00Z') }],
  ['an uninstalled one', { deleted_at: new Date('2026-10-01T00:00:00Z') }],
  [
    'one the admission policy rejected',
    { admission_status: 'rejected' as const, admission_reason: 'policy_changed' as const },
  ],
])('a repository of %s is the very 404 of a repository that does not exist', async (_label, change) => {
  const { world, ada, body } = await signingWorld();
  const unknown = await refused(world, ada, body({ githubRepoId: 987_654 }), [404, 'not_found']);
  await world.db.updateTable('installations').set(change).where('id', '=', world.t1.installationId).execute();
  const hidden = await refused(world, ada, body(), [404, 'not_found']);
  expect(hidden.text).toBe(unknown.text);
});

test('a repository that was disabled after the link was sent can still be signed for, as the sign page shows it', async () => {
  const { world, ada, body } = await signingWorld();
  await world.db.updateTable('repositories').set({ enabled: false }).where('id', '=', world.t1.repositoryId).execute();
  const response = await postSign(world, ada, body());
  expect(response.statusCode).toBe(201);
});

test('a repository with no document is a 409 no_active_cla', async () => {
  const { world, ada, body } = await signingWorld();
  await world.db
    .updateTable('repositories')
    .set({ cla_document_id: null })
    .where('id', '=', world.t1.repositoryId)
    .execute();
  await refused(world, ada, body(), [409, 'no_active_cla']);
});

test('a document with no active version is a 409 no_active_cla', async () => {
  const { world, ada, body } = await signingWorld();
  await world.db
    .updateTable('cla_documents')
    .set({ active_version_id: null })
    .where('id', '=', world.t1.documentId)
    .execute();
  await refused(world, ada, body(), [409, 'no_active_cla']);
});

test('a version that is no longer in force is a 409 stale_version that names the version in force, so the page can load it', async () => {
  const { world, ada, body } = await signingWorld();
  const next = await publishNext(world, 1, 1);
  const { error } = await refused(world, ada, body(), [409, 'stale_version']);
  expect(error.details).toEqual({
    current: { versionId: next.id, major: 1, minor: 1, contentSha256: next.sha },
  });
  const current = await postSign(world, ada, body({ versionId: next.id, contentSha256: next.sha }));
  expect(current.statusCode).toBe(201);
});

test('an unknown version id and the version of another tenant are the very same stale_version, so nothing is confirmed about the other tenant', async () => {
  const { world, ada, body } = await signingWorld();
  const unknown = await refused(world, ada, body({ versionId: 987_654 }), [409, 'stale_version']);
  const foreign = await refused(world, ada, body({ versionId: world.t2.versionId }), [409, 'stale_version']);
  expect(foreign.text).toBe(unknown.text);
  expect(unknown.error.details).toEqual({
    current: { versionId: world.t1.versionId, major: 1, minor: 0, contentSha256: world.t1.contentSha256 },
  });
});

test('a hash that is not the stored hash of the version is a 422 hash_mismatch with no detail', async () => {
  const { world, ada, body } = await signingWorld();
  const { error } = await refused(world, ada, body({ contentSha256: 'b'.repeat(64) }), [422, 'hash_mismatch']);
  expect(error.details).toBeUndefined();
});

test.each([
  ['the previous sentence', 'individual-v0'],
  ['the next one', 'individual-v2'],
  ['an id of the right shape that was never issued', 'zzzz-v1'],
  ['an object property name', '__proto__'],
])('%s as the consent sentence is a 409 stale_consent', async (_label, consentTextId) => {
  const { world, ada, body } = await signingWorld();
  await refused(world, ada, body({ consentTextId }), [409, 'stale_consent']);
});

test('a document that is not an individual CLA is a 409 unsupported_document_kind', async () => {
  const { world, ada } = await signingWorld();
  const corporate = await enforceCorporateDocument(world);
  const request = bodyFor(world.t1, 1, corporate);
  await refused(world, ada, request, [409, 'unsupported_document_kind']);
});

test.each([
  ['a control character in the name', { name: 'Ada\u0007' }, 'invalid_name'],
  ['a bidirectional override in the name', { name: `exe.${RLO}live` }, 'invalid_name'],
  ['a name that is only white space', { name: ' \t ' }, 'invalid_name'],
  ['a name of 201 code points', { name: '\u{1F600}'.repeat(201) }, 'invalid_name'],
  ['an address that is not verified', { email: 'eve@example.org' }, 'email_not_verified'],
  ['an address that only looks like the verified one', { email: 'ada@examp1e.org' }, 'email_not_verified'],
  ['an empty address', { email: '' }, 'email_not_verified'],
  ['an address of 255 characters', { email: `${'a'.repeat(243)}@example.org` }, 'email_not_verified'],
] as const)('%s is a 422 with its own code and no detail', async (_label, overrides, code) => {
  const { world, ada, body } = await signingWorld();
  const { error } = await refused(world, ada, body(overrides), [422, code]);
  expect(error.details).toBeUndefined();
});

test('a person with no verified address is a 422 no_verified_email, whatever address they ask for', async () => {
  const { world, body } = await signingWorld();
  const nobody = await signerWith(world, 4321, []);
  await refused(world, nobody, body({ email: ADA_EMAIL.email }), [422, 'no_verified_email']);
});

test('an address that is verified for another person is not accepted, because the list is the one of the session', async () => {
  const { world, body } = await signingWorld();
  const grace = await signerWith(world, 4321, [{ email: 'grace@example.org', primary: true }]);
  await refused(world, grace, body({ email: ADA_EMAIL.email }), [422, 'email_not_verified']);
});

test.each([
  [
    'an unknown repository comes before anything',
    { githubRepoId: 987_654, versionId: 1, consentTextId: 'x' },
    [404, 'not_found'],
  ],
  [
    'the version comes before the hash, the sentence and the name',
    { versionId: 987_654, contentSha256: 'b'.repeat(64), consentTextId: 'x', name: '\u0007' },
    [409, 'stale_version'],
  ],
  [
    'the hash comes before the sentence and the name',
    { contentSha256: 'b'.repeat(64), consentTextId: 'x', name: '\u0007' },
    [422, 'hash_mismatch'],
  ],
  [
    'the sentence comes before the name and the address',
    { consentTextId: 'x', name: '\u0007', email: 'eve@example.org' },
    [409, 'stale_consent'],
  ],
  ['the name comes before the address', { name: '\u0007', email: 'eve@example.org' }, [422, 'invalid_name']],
] as const)('%s', async (_label, overrides, expected) => {
  const { world, ada, body } = await signingWorld();
  await refused(world, ada, body(overrides), expected);
});

test('the kind of the document comes after the sentence and before the name', async () => {
  const { world, ada } = await signingWorld();
  const corporate = await enforceCorporateDocument(world);
  const stale = bodyFor(world.t1, 1, { ...corporate, consentTextId: 'x', name: '\u0007' });
  await refused(world, ada, stale, [409, 'stale_consent']);
  const named = bodyFor(world.t1, 1, { ...corporate, name: '\u0007' });
  await refused(world, ada, named, [409, 'unsupported_document_kind']);
});

test('the status of every code is the one the shared tables say, spelled out here on purpose', () => {
  expect(SIGN_REFUSAL_STATUS).toEqual({
    stale_version: 409,
    hash_mismatch: 422,
    stale_consent: 409,
    unsupported_document_kind: 409,
  });
  expect(SIGNER_RULE_STATUS).toEqual({ invalid_name: 422, email_not_verified: 422, no_verified_email: 422 });
});

test.each([
  ['a name that breaks a rule', { name: 'zzzz-typed-name\u0007' }],
  ['an address that is not verified', { email: 'zzzz-typed@example.org' }],
  ['a stale version', { versionId: 987_654, name: 'zzzz-typed-name', email: 'zzzz-typed@example.org' }],
  ['a hash mismatch', { contentSha256: 'b'.repeat(64), name: 'zzzz-typed-name', email: 'zzzz-typed@example.org' }],
])('%s: neither the error body nor the log holds what was typed', async (_label, overrides) => {
  const { world, ada, body } = await signingWorld();
  const response = await postSign(world, ada, body(overrides));
  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  expect(response.body).not.toContain('zzzz');
  expect(world.logs.text()).not.toContain('zzzz');
});
