// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { signedOf, signingWorld, writtenRows } from './sign-fixture/test-support.ts';
import { RECORDING, signFrom, storedNetwork, TEST_AGENT, TEST_IP } from './sign-network-fixture/test-support.ts';

// Where the network values of a signing stay (E13-S05): on the `signer_pii` row of the signature that was recorded, and nowhere
// else. A repeat of the request neither adds nor overwrites them, and the audit row, the logs and the answers never hold them.

const OTHER_IP = '2001:db8::99';
const OTHER_AGENT = 'zzzz-other-agent/9.9';

test('a repeat from another address and another browser leaves the first values alone and adds no row', async () => {
  const state = await signingWorld(RECORDING);
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } }), 201);
  const repeat = await signFrom(
    state,
    { remoteAddress: OTHER_IP, headers: { 'user-agent': OTHER_AGENT } },
    { name: 'Someone Else' },
  );
  expect(signedOf(repeat, 200).created).toBe(false);
  expect(await storedNetwork(state.world.db)).toEqual([{ ip: TEST_IP, userAgent: TEST_AGENT }]);
  expect(await writtenRows(state.world.db)).toEqual({ signatures: 1, signerPii: 1, audit: 1 });
});

test('a repeat of a signing made with recording off stores nothing either, even when the repeat carries values', async () => {
  const state = await signingWorld();
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } }), 201);
  signedOf(await signFrom(state, { remoteAddress: OTHER_IP, headers: { 'user-agent': OTHER_AGENT } }), 200);
  expect(await storedNetwork(state.world.db)).toEqual([{ ip: null, userAgent: null }]);
});

test('the 201 and the 200 hold neither value', async () => {
  const state = await signingWorld(RECORDING);
  const from = { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } };
  const created = await signFrom(state, from);
  const replayed = await signFrom(state, from);
  expect([created.statusCode, replayed.statusCode]).toEqual([201, 200]);
  for (const response of [created, replayed]) {
    expect(response.body).not.toContain(TEST_IP);
    expect(response.body).not.toContain(TEST_AGENT);
    expect(JSON.stringify(response.headers)).not.toContain(TEST_AGENT);
  }
});

test('the audit row, the signature row and the log hold neither value, and the log line of the request is the method and the path', async () => {
  const state = await signingWorld(RECORDING);
  signedOf(await signFrom(state, { remoteAddress: TEST_IP, headers: { 'user-agent': TEST_AGENT } }), 201);
  const { db, logs } = state.world;
  const audit = await db.selectFrom('audit_log').selectAll().where('action', '=', 'signature.created').execute();
  expect(audit).toHaveLength(1);
  const signatures = await db.selectFrom('signatures').selectAll().execute();
  for (const text of [JSON.stringify(audit), JSON.stringify(signatures), logs.text()]) {
    expect(text).not.toContain(TEST_IP);
    expect(text).not.toContain(TEST_AGENT);
  }
  expect(audit[0]?.metadata).toEqual({
    document_id: state.world.t1.documentId,
    version_id: state.world.t1.versionId,
    major: 1,
    source_repository_id: state.world.t1.repositoryId,
    source_pr_number: 45,
  });
  const requests = logs.lines().flatMap((line) => (line['req'] === undefined ? [] : [line['req']]));
  expect(requests).toEqual([{ method: 'POST', url: '/api/sign' }]);
});
