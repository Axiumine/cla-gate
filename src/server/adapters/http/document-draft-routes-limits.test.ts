// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test, vi } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { type DocumentWorld, documentWorld, draftPath, errorCodeOf, parsed } from './document-fixture/test-support.ts';
import { CLA_BODY_LIMIT } from './limits.ts';

// The limits of the draft routes (E12-S03): 30 saves a minute for each person, keyed on the person and not on the address;
// a body of 512 KiB at most; JSON only. The save is the one route of the epic with a budget of its own.

const SAVES_A_MINUTE = 30;

// The guard of a write route asks GitHub for the role of the person every time, and a person has 30 uncached lookups a
// minute (E11-S04): in an organisation that budget runs out at the same save as this one and answers first, without the
// headers of the rate limit. The tests of the budget of the save therefore run for installations of a user account, whose
// owner is told by comparing ids and costs no lookup, so the budget of the save is the only one that can answer 429. The
// owner of the installation `n` of the world has the GitHub id 7000 * n (`seedTenant`).

/** The world with both installations turned into user accounts, and the owners of the two logged in. */
async function ownersWorld() {
  const world = await documentWorld();
  await world.db.updateTable('installations').set({ account_type: 'User' }).execute();
  return { world, owner1: await world.login(7000), owner2: await world.login(14_000) };
}

type Owner = Awaited<ReturnType<typeof ownersWorld>>['owner1'];

/** A save as `owner` of the wide document of installation `n`, from `address` when one is given. */
function saveAs(
  world: DocumentWorld,
  owner: Owner,
  target: { readonly n: 1 | 2; readonly expectedRevision: number | null },
  address?: string,
) {
  const tenant = target.n === 1 ? world.t1 : world.t2;
  return world.app.inject({
    method: 'PUT',
    url: draftPath(tenant.installationId, tenant.documentId),
    headers: owner.headers,
    ...(address === undefined ? {} : { remoteAddress: address }),
    payload: { contentMd: 'Saved\n', expectedRevision: target.expectedRevision },
  });
}

/** `count` saves in a row, each naming the revision the last one made. Returns the statuses. */
async function saveRepeatedly(world: DocumentWorld, owner: Owner, n: 1 | 2, count: number): Promise<number[]> {
  const statuses: number[] = [];
  let expectedRevision: number | null = null;
  for (let sent = 0; sent < count; sent++) {
    const response = await saveAs(world, owner, { n, expectedRevision });
    statuses.push(response.statusCode);
    expectedRevision =
      response.statusCode === 200 ? response.json<{ draft: { revision: number } }>().draft.revision : expectedRevision;
  }
  return statuses;
}

test('a person may save 30 times a minute; the 31st is 429 too_many_requests in the standard body, with the budget in the headers', async () => {
  const { world, owner1 } = await ownersWorld();
  const allowed = await saveRepeatedly(world, owner1, 1, SAVES_A_MINUTE);
  expect(new Set(allowed)).toEqual(new Set([200]));
  const limited = await saveAs(world, owner1, { n: 1, expectedRevision: 30 });
  expect(limited.statusCode).toBe(429);
  expect(parsed(limited, errorResponseSchema).error.code).toBe('too_many_requests');
  expect(limited.headers['x-ratelimit-limit']).toBe('30');
  expect(limited.headers['x-ratelimit-remaining']).toBe('0');
  // The window is a minute from the first save; the saves before this one may have taken seconds on a busy machine.
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
  const stored = await world.db
    .selectFrom('cla_drafts')
    .select(['revision'])
    .where('document_id', '=', world.t1.documentId)
    .executeTakeFirstOrThrow();
  expect(stored.revision).toBe(30);
});

test('the budget is the person and not the address: the owner of the other installation keeps their own 30, and a new address does not renew it', async () => {
  const { world, owner1, owner2 } = await ownersWorld();
  await saveRepeatedly(world, owner1, 1, SAVES_A_MINUTE);
  const elsewhere = await saveAs(world, owner1, { n: 1, expectedRevision: 30 }, '203.0.113.77');
  const other = await saveRepeatedly(world, owner2, 2, 1);
  const sameAddress = await saveAs(world, owner2, { n: 2, expectedRevision: 1 }, '127.0.0.1');
  expect([elsewhere.statusCode, other, sameAddress.statusCode]).toEqual([429, [200], 200]);
});

test('the budget is full again when the minute is over, and not before', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const { world, owner1 } = await ownersWorld();
  await saveRepeatedly(world, owner1, 1, SAVES_A_MINUTE);
  expect((await saveAs(world, owner1, { n: 1, expectedRevision: 30 })).statusCode).toBe(429);
  vi.setSystemTime(Date.now() + 30_000);
  expect((await saveAs(world, owner1, { n: 1, expectedRevision: 30 })).statusCode).toBe(429);
  vi.setSystemTime(Date.now() + 31_000);
  expect((await saveAs(world, owner1, { n: 1, expectedRevision: 30 })).statusCode).toBe(200);
});

test('a call the guard refuses does not spend the budget: 40 saves of a stranger are 404 and not 429, and the owner can still save', async () => {
  const { world, owner1 } = await ownersWorld();
  const stranger = await world.login(world.people.member1.githubId);
  const refused: number[] = [];
  for (let sent = 0; sent < 40; sent++) {
    refused.push((await saveAs(world, stranger, { n: 1, expectedRevision: null })).statusCode);
  }
  expect(new Set(refused)).toEqual(new Set([404]));
  expect(await saveRepeatedly(world, owner1, 1, 1)).toEqual([200]);
});

test('a save that conflicts counts like any other: it is a request the guard let in', async () => {
  const { world, owner1 } = await ownersWorld();
  const statuses: number[] = [];
  for (let sent = 0; sent <= SAVES_A_MINUTE; sent++) {
    statuses.push((await saveAs(world, owner1, { n: 1, expectedRevision: 9 })).statusCode);
  }
  expect([...new Set(statuses.slice(0, SAVES_A_MINUTE))]).toEqual([409]);
  expect(statuses.at(SAVES_A_MINUTE)).toBe(429);
});

/** A JSON body of exactly `bytes` bytes for the save route. */
function bodyOf(bytes: number): string {
  const frame = JSON.stringify({ contentMd: '', expectedRevision: null });
  return JSON.stringify({ contentMd: 'a'.repeat(bytes - frame.length), expectedRevision: null });
}

async function sendRaw(world: DocumentWorld, method: 'PUT' | 'DELETE', type: string, payload: string) {
  const admin = await world.login(world.people.admin1.githubId);
  return world.app.inject({
    method,
    url: draftPath(world.t1.installationId, world.t1.documentId),
    headers: { ...admin.headers, 'content-type': type },
    payload,
  });
}

test('a body of exactly 512 KiB is read (and its text refused as too large), one byte more is 413, and nothing is stored', async () => {
  const world = await documentWorld();
  const atLimit = await sendRaw(world, 'PUT', 'application/json', bodyOf(CLA_BODY_LIMIT));
  const over = await sendRaw(world, 'PUT', 'application/json', bodyOf(CLA_BODY_LIMIT + 1));
  expect([atLimit.statusCode, errorCodeOf(atLimit)]).toEqual([422, 'content_too_large']);
  expect([over.statusCode, errorCodeOf(over)]).toEqual([413, 'payload_too_large']);
  expect(await world.db.selectFrom('cla_drafts').select('document_id').execute()).toHaveLength(2);
});

test('a discard does not take a body larger than 512 KiB either', async () => {
  const world = await documentWorld();
  const over = await sendRaw(world, 'DELETE', 'application/json', bodyOf(CLA_BODY_LIMIT + 1));
  expect([over.statusCode, errorCodeOf(over)]).toEqual([413, 'payload_too_large']);
  expect(await world.db.selectFrom('cla_drafts').select('document_id').execute()).toHaveLength(2);
});

test.each([
  ['a Markdown file', 'text/markdown', '# Title\n'],
  ['plain text', 'text/plain', 'Terms'],
  ['a urlencoded form', 'application/x-www-form-urlencoded', 'contentMd=Terms'],
  ['multipart form data, the shape of a file upload', 'multipart/form-data; boundary=xyz', '--xyz--\r\n'],
  ['a JSON look-alike', 'application/jsonp', '{"contentMd":"Terms","expectedRevision":null}'],
])('a save sent as %s is 415 unsupported_media_type and stores nothing', async (_label, type, payload) => {
  const world = await documentWorld();
  const response = await sendRaw(world, 'PUT', type, payload);
  expect([response.statusCode, errorCodeOf(response)]).toEqual([415, 'unsupported_media_type']);
  expect(await world.db.selectFrom('cla_drafts').select('document_id').execute()).toHaveLength(2);
});

test('application/json with a charset is read like application/json', async () => {
  const world = await documentWorld();
  const response = await sendRaw(
    world,
    'PUT',
    'application/json; charset=utf-8',
    JSON.stringify({ contentMd: 'Terms\n', expectedRevision: null }),
  );
  expect(response.statusCode).toBe(200);
});
