// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { CLA_TEXT_MAX_BYTES } from '../../../shared/cla-text.ts';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { prepareClaText, sha256Hex } from '../../services/cla-content.ts';
import { ClaRuleError } from '../../services/cla-rule-error.ts';
import { PUBLIC_ROUTE } from '../../test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { answerRuleErrors } from './cla-rule-errors.ts';
import { CLA_BODY_LIMIT } from './limits.ts';
import { parseInput } from './request-body.ts';

// How the routes of the CLA documents answer a rule the request broke (E12-S01, E12-S02), and the text of a CLA on the wire.
// No route of this story takes a text (drafts and versions come with E12-S03 and E12-S04), so a probe route stands in for
// them: it is registered the way the routes of the epic are, with the rule error handler and the body limit of the epic, and
// it does what they will do, `prepareClaText` over the body.

const PROBE = '/probe/cla-text';
const HOSTILE_TEXT = 'MARKER-OF-A-HOSTILE-TEXT';

const probeBody = z.strictObject({ contentMd: z.string() });

const probe: FastifyPluginCallbackZod = (scope, _options, done) => {
  answerRuleErrors(scope);
  scope.post(PROBE, { ...PUBLIC_ROUTE, bodyLimit: CLA_BODY_LIMIT }, (request) => {
    const prepared = prepareClaText(parseInput(probeBody, request.body).contentMd);
    return { contentSha256: prepared.contentSha256, bytes: prepared.contentMd.length };
  });
  scope.post('/probe/cla-rule', PUBLIC_ROUTE, (request) => {
    const { rule } = z.strictObject({ rule: z.enum(['not_found', 'document_name_taken']) }).parse(request.body);
    throw new ClaRuleError(rule);
  });
  done();
};

async function probeWorld() {
  const world = await authWorld();
  await world.app.register(probe);
  const person = await world.login(1001);
  const send = (payload: string) =>
    world.app.inject({
      method: 'POST',
      url: PROBE,
      headers: { ...person.headers, 'content-type': 'application/json' },
      payload,
    });
  return { world, person, send };
}

const bodyOf = (contentMd: string): string => JSON.stringify({ contentMd });

const REFUSED = [
  { label: 'a NUL', code: 'content_invalid_characters', details: undefined, text: `${HOSTILE_TEXT}\u0000` },
  {
    label: 'a lone surrogate',
    code: 'content_invalid_characters',
    details: undefined,
    text: `${HOSTILE_TEXT}${String.fromCharCode(0xd800)}`,
  },
  { label: 'nothing but white space', code: 'content_empty', details: undefined, text: ' \r\n\t\r\n' },
  {
    label: 'block quotes nested 51 levels',
    code: 'content_too_deeply_nested',
    details: undefined,
    text: `${'> '.repeat(51)}${HOSTILE_TEXT}`,
  },
  {
    label: 'more bytes than the limit',
    code: 'content_too_large',
    details: { limitBytes: 204_800, actualBytes: HOSTILE_TEXT.length + CLA_TEXT_MAX_BYTES + 1 },
    text: `${HOSTILE_TEXT}${'a'.repeat(CLA_TEXT_MAX_BYTES)}`,
  },
] as const;

test('a text that breaks a rule is 422 with the code of the rule and its details only, and none of the text is in the answer or the log', async () => {
  const { world, send } = await probeWorld();
  for (const { label, code, details, text } of REFUSED) {
    const response = await send(bodyOf(text));
    expect(response.statusCode, label).toBe(422);
    const { error } = errorResponseSchema.parse(response.json());
    expect(error, label).toMatchObject({ code, message: 'Unprocessable Entity' });
    expect(error.details, label).toStrictEqual(details);
    expect(response.body, label).not.toContain(HOSTILE_TEXT);
  }
  expect(world.logs.text()).not.toContain(HOSTILE_TEXT);
});

test('a text of CRLF lines is answered with the hash of the canonical text', async () => {
  const { send } = await probeWorld();
  const response = await send(bodyOf('One  \r\nTwo\r\n\r\n'));
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ contentSha256: sha256Hex('One  \nTwo\n'), bytes: 'One  \nTwo\n'.length });
});

test('the text of the most bytes a CLA may have, every character of it two bytes in JSON, is read whole and not refused for its size', async () => {
  const { send } = await probeWorld();
  const text = `${'"'.repeat(CLA_TEXT_MAX_BYTES - 1)}\n`;
  const payload = bodyOf(text);
  expect(Buffer.byteLength(payload)).toBeGreaterThan(CLA_TEXT_MAX_BYTES * 2 - 10);
  expect(Buffer.byteLength(payload)).toBeLessThan(CLA_BODY_LIMIT);
  const response = await send(payload);
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ contentSha256: sha256Hex(text), bytes: CLA_TEXT_MAX_BYTES });
});

test('a body over 512 KiB is 413 before it is parsed, and one of exactly 512 KiB is read and then refused for its size', async () => {
  const { send } = await probeWorld();
  const frame = bodyOf('').length;
  const atLimit = await send(bodyOf('a'.repeat(CLA_BODY_LIMIT - frame)));
  const over = await send(bodyOf('a'.repeat(CLA_BODY_LIMIT - frame + 1)));
  expect(Buffer.byteLength(bodyOf('a'.repeat(CLA_BODY_LIMIT - frame)))).toBe(CLA_BODY_LIMIT);
  expect(atLimit.statusCode).toBe(422);
  expect(errorResponseSchema.parse(atLimit.json()).error.code).toBe('content_too_large');
  expect(over.statusCode).toBe(413);
  expect(errorResponseSchema.parse(over.json()).error).toMatchObject({ code: 'payload_too_large' });
});

test('a rule without details is answered with its status and code and no details', async () => {
  const { world, person } = await probeWorld();
  const response = await world.app.inject({
    method: 'POST',
    url: '/probe/cla-rule',
    headers: { ...person.headers, 'content-type': 'application/json' },
    payload: JSON.stringify({ rule: 'document_name_taken' }),
  });
  expect(response.statusCode).toBe(409);
  const { error } = errorResponseSchema.parse(response.json());
  expect(error.code).toBe('document_name_taken');
  expect('details' in error).toBe(false);
});

test('an error that is not a rule is answered as the application answers it', async () => {
  const { world, person } = await probeWorld();
  const response = await world.app.inject({
    method: 'POST',
    url: '/probe/cla-rule',
    headers: { ...person.headers, 'content-type': 'application/json' },
    payload: JSON.stringify({ rule: 'something_else' }),
  });
  expect(response.statusCode).toBe(500);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('internal_server_error');
});
