// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { erasureWorld } from './erasure-fixture/test-support.ts';

// What the erasure tells the log (E16-S04): numeric ids and counts only. The person's login, name and email are unique
// strings here, so a line that carries one of them is found; the request body, the query string and the answer are never
// logged, whether the call succeeds or is refused.

const MEMBER1 = 31_004;
const SENTINELS = ['sentinel-login-4f1c', 'Sentinel Name 4f1c', 'sentinel-4f1c@example.test'] as const;

/** The world with the personal data of `member1` replaced by the sentinel strings, in `users` and in `signer_pii`. */
async function worldWithSentinels() {
  const world = await erasureWorld();
  const [login, name, email] = SENTINELS;
  await world.db.updateTable('users').set({ login, name }).where('github_id', '=', MEMBER1).execute();
  await world.db
    .updateTable('signer_pii')
    .set({ login, name, email })
    .where('user_id', '=', world.t1.signer.userId)
    .execute();
  return world;
}

test('an erasure logs one line with the installation, the person, the admin and the two counts, and nothing else of the request', async () => {
  const { erase, logs, t1 } = await worldWithSentinels();
  const response = await erase('admin1', t1.installationId, { githubUserId: MEMBER1, expectedRows: 1 });
  expect(response.statusCode).toBe(200);

  const done = logs.lines().filter((line) => line['msg'] === 'signer_erasure_done');
  expect(done).toHaveLength(1);
  expect(done[0]).toMatchObject({
    installationId: t1.installationId,
    githubUserId: MEMBER1,
    actorGithubId: 31_001,
    expectedRows: 1,
    erasedRows: 1,
  });
  const extra = Object.keys(done[0] ?? {}).filter(
    (key) =>
      ![
        'level',
        'time',
        'pid',
        'hostname',
        'reqId',
        'msg',
        'installationId',
        'githubUserId',
        'actorGithubId',
        'expectedRows',
        'erasedRows',
      ].includes(key),
  );
  expect(extra).toEqual([]);
  for (const sentinel of SENTINELS) {
    expect(logs.text()).not.toContain(sentinel);
  }
});

test.each([
  ['a count that is no longer the right one', { githubUserId: MEMBER1, expectedRows: 5 }, 409],
  ['a person with no signature here', { githubUserId: 987_654, expectedRows: 0 }, 404],
  [
    'a body that carries the personal data itself',
    { githubUserId: MEMBER1, expectedRows: 1, login: SENTINELS[0], name: SENTINELS[1], email: SENTINELS[2] },
    400,
  ],
])('a refused erasure (%s) logs no personal data and no body', async (_name, payload, status) => {
  const { erase, logs, t1 } = await worldWithSentinels();
  expect((await erase('admin1', t1.installationId, payload)).statusCode).toBe(status);

  expect(logs.lines().filter((line) => line['msg'] === 'signer_erasure_done')).toEqual([]);
  expect(logs.lines().filter((line) => line['msg'] === 'request rejected')).toEqual([
    expect.objectContaining({ statusCode: status }),
  ]);
  for (const sentinel of SENTINELS) {
    expect(logs.text()).not.toContain(sentinel);
  }
  expect(logs.text()).not.toContain('expectedRows');
});

test('a preview logs no personal data either', async () => {
  const { preview, logs, t1 } = await worldWithSentinels();
  expect((await preview('admin1', t1.installationId, `?githubUserId=${MEMBER1}`)).statusCode).toBe(200);
  for (const sentinel of SENTINELS) {
    expect(logs.text()).not.toContain(sentinel);
  }
});
