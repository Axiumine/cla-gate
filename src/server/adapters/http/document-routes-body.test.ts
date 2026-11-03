// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { documentCount, documentsPath, documentWorld, errorCodeOf, parsed } from './document-fixture/test-support.ts';
import { CLA_BODY_LIMIT, HTTP_LIMITS } from './limits.ts';

// The CLA routes of epic E12 that change data read `application/json` and nothing else, and their body may hold 512 KiB at
// most (E12-S02): a text of the largest size, JSON-escaped, fits, and the Markdown file of a maintainer is read by the browser
// and sent as `contentMd`, never uploaded as a file. These tests show it on the routes that exist; the route table test
// (cla-body-limit-route-table.test.ts) makes every later route of the epic carry the limit too.

/** A JSON body of exactly `bytes` bytes for the create or the rename route, padded with the characters of the name. */
function bodyOf(bytes: number, extra: object): string {
  const frame = JSON.stringify({ name: '', ...extra });
  return JSON.stringify({ name: 'a'.repeat(bytes - frame.length), ...extra });
}

async function sendAs(
  world: Awaited<ReturnType<typeof documentWorld>>,
  request: { method: 'POST' | 'PATCH'; url: string; type: string; payload: string },
) {
  const admin = await world.login(world.people.admin1.githubId);
  return world.app.inject({
    method: request.method,
    url: request.url,
    headers: { ...admin.headers, 'content-type': request.type },
    payload: request.payload,
  });
}

test('the limit is 512 KiB, below the 1 MiB every other route keeps', () => {
  expect(CLA_BODY_LIMIT).toBe(512 * 1024);
  expect(CLA_BODY_LIMIT).toBeLessThan(HTTP_LIMITS.bodyLimit);
});

test('a JSON-escaped text of the most bytes a CLA may have, whose characters all take two bytes in JSON, fits the limit with its envelope', () => {
  const text = `${'"'.repeat(204_799)}\n`;
  const body = JSON.stringify({ contentMd: text, expectedRevision: null, rationale: 'r'.repeat(2000) });
  expect(new TextEncoder().encode(text).byteLength).toBe(204_800);
  expect(new TextEncoder().encode(body).byteLength).toBeLessThan(CLA_BODY_LIMIT);
});

test.each([
  ['POST create', 'POST', { kind: 'individual' }],
  ['PATCH rename', 'PATCH', {}],
] as const)(
  '%s: a body of exactly 512 KiB is read, and one byte more is 413 payload_too_large with nothing stored',
  async (_label, method, extra) => {
    const world = await documentWorld();
    const url =
      method === 'POST'
        ? documentsPath(world.t1.installationId)
        : `${documentsPath(world.t1.installationId)}/${world.t1.documentId}`;
    const before = await documentCount(world);
    const atLimit = await sendAs(world, {
      method,
      url,
      type: 'application/json',
      payload: bodyOf(CLA_BODY_LIMIT, extra),
    });
    const over = await sendAs(world, {
      method,
      url,
      type: 'application/json',
      payload: bodyOf(CLA_BODY_LIMIT + 1, extra),
    });
    // At the limit the body is read, and it is then the name, 524 thousand characters long, that the route refuses.
    expect([atLimit.statusCode, errorCodeOf(atLimit)]).toEqual([422, 'invalid_name']);
    expect([over.statusCode, errorCodeOf(over)]).toEqual([413, 'payload_too_large']);
    expect(parsed(over, errorResponseSchema).error.message).toBe('Payload Too Large');
    expect(await documentCount(world)).toBe(before);
  },
);

test('a body between 512 KiB and the 1 MiB of other routes is refused here, though the app as a whole would take it', async () => {
  const world = await documentWorld();
  const response = await sendAs(world, {
    method: 'POST',
    url: documentsPath(world.t1.installationId),
    type: 'application/json',
    payload: bodyOf(HTTP_LIMITS.bodyLimit - 1, { kind: 'individual' }),
  });
  expect(response.statusCode).toBe(413);
});

const NOT_JSON = [
  ['a Markdown file', 'text/markdown', '# Title\n'],
  ['plain text', 'text/plain', 'Individual CLA'],
  ['a urlencoded form', 'application/x-www-form-urlencoded', 'name=Individual+CLA&kind=individual'],
  ['multipart form data, the shape of a file upload', 'multipart/form-data; boundary=xyz', '--xyz--\r\n'],
  ['a JSON look-alike', 'application/jsonp', '{"name":"Individual CLA","kind":"individual"}'],
  ['bytes', 'application/octet-stream', 'bytes'],
] as const;

test.each([
  ['POST create', 'POST', ''],
  ['PATCH rename', 'PATCH', '/:documentId'],
] as const)(
  '%s reads application/json only: a file, a form or text is 415 unsupported_media_type and stores nothing',
  async (_label, method, suffix) => {
    const world = await documentWorld();
    const url = `${documentsPath(world.t1.installationId)}${suffix.replace(':documentId', String(world.t1.documentId))}`;
    const before = await documentCount(world);
    for (const [label, type, payload] of NOT_JSON) {
      const response = await sendAs(world, { method, url, type, payload });
      expect([label, response.statusCode, errorCodeOf(response)]).toEqual([label, 415, 'unsupported_media_type']);
    }
    expect(await documentCount(world)).toBe(before);
  },
);

test('application/json with a charset is read like application/json', async () => {
  const world = await documentWorld();
  const response = await sendAs(world, {
    method: 'POST',
    url: documentsPath(world.t1.installationId),
    type: 'application/json; charset=utf-8',
    payload: JSON.stringify({ name: 'With a charset', kind: 'individual' }),
  });
  expect(response.statusCode).toBe(201);
});
