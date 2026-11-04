// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { SIGNER_RULE_STATUS } from '../../../shared/signer-input.ts';
import { SignRuleError } from '../../services/sign-rule-error.ts';
import { checkSignerInput } from '../../services/signer-input.ts';
import { PUBLIC_ROUTE } from '../../test-support.ts';
import { authWorld } from './auth-fixture/test-support.ts';
import { parseInput } from './request-body.ts';
import { answerSignRuleErrors } from './sign-rule-errors.ts';

// How the signing route answers a name or an address that breaks a rule (E13-S03). The route itself is E13-S04, so a probe
// route stands in for it: registered the way the signing route will be (with the rule error handler), reading the body and the
// verified list of the session and doing what the route will do first, `checkSignerInput`.

const PROBE = '/probe/sign-input';
const MARKER_NAME = 'zzzz-typed-name';
const MARKER_EMAIL = 'zzzz-typed-address@example.org';
const VERIFIED = ['Ada@Example.org', 'lovelace@example.net'];
/** U+202E, the right-to-left override. */
const RLO = String.fromCodePoint(0x202e);

const probeBody = z.strictObject({ name: z.string(), email: z.string(), verified: z.array(z.string()).optional() });

const probe: FastifyPluginCallbackZod = (scope, _options, done) => {
  answerSignRuleErrors(scope);
  scope.post(PROBE, PUBLIC_ROUTE, (request) => {
    const { name, email, verified = VERIFIED } = parseInput(probeBody, request.body);
    return checkSignerInput(
      { name, email },
      verified.map((address) => ({ email: address, primary: false })),
    );
  });
  scope.post('/probe/sign-rule', PUBLIC_ROUTE, (request) => {
    const { rule } = z
      .strictObject({ rule: z.enum(['invalid_name', 'email_not_verified', 'no_verified_email']) })
      .parse(request.body);
    throw new SignRuleError(rule);
  });
  scope.post('/probe/other-error', PUBLIC_ROUTE, () => {
    throw new Error('not a rule');
  });
  done();
};

async function probeWorld() {
  const world = await authWorld();
  await world.app.register(probe);
  const person = await world.login(1001);
  const send = (body: unknown, url = PROBE) =>
    world.app.inject({
      method: 'POST',
      url,
      headers: { ...person.headers, 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    });
  return { world, send };
}

test('a good name and a verified address are answered with the cleaned name and the address as GitHub reported it', async () => {
  const { send } = await probeWorld();
  const response = await send({ name: ' Ada  Lovelace ', email: ' ADA@example.org ' });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toStrictEqual({ name: 'Ada Lovelace', email: 'Ada@Example.org' });
});

test('every hostile name is accepted and answered unchanged', async () => {
  const { send } = await probeWorld();
  for (const name of HOSTILE_NAMES) {
    const response = await send({ name, email: 'lovelace@example.net' });
    expect(response.statusCode, name).toBe(200);
    expect(response.json(), name).toStrictEqual({ name, email: 'lovelace@example.net' });
  }
});

const REFUSED = [
  {
    label: 'a name with a line feed',
    body: { name: `${MARKER_NAME}\n`, email: 'lovelace@example.net' },
    code: 'invalid_name',
  },
  {
    label: 'a name with a right-to-left override',
    body: { name: `${MARKER_NAME}${RLO}`, email: 'lovelace@example.net' },
    code: 'invalid_name',
  },
  {
    label: 'a name of 201 code points',
    body: { name: `${MARKER_NAME}${'x'.repeat(201)}`, email: 'lovelace@example.net' },
    code: 'invalid_name',
  },
  { label: 'an empty name', body: { name: '  ', email: 'lovelace@example.net' }, code: 'invalid_name' },
  {
    label: 'an address that is not verified',
    body: { name: MARKER_NAME, email: MARKER_EMAIL },
    code: 'email_not_verified',
  },
  {
    label: 'an address over 254 characters',
    body: { name: MARKER_NAME, email: `${MARKER_EMAIL}${'a'.repeat(260)}` },
    code: 'email_not_verified',
  },
  {
    label: 'an empty list of verified addresses',
    body: { name: MARKER_NAME, email: MARKER_EMAIL, verified: [] },
    code: 'no_verified_email',
  },
] as const;

test('a name or an address that breaks a rule is 422 with its code and no detail, and nothing typed is in the body or the log', async () => {
  const { world, send } = await probeWorld();
  for (const { label, body, code } of REFUSED) {
    const logged = world.logs.text().length;
    const response = await send(body);
    expect(response.statusCode, label).toBe(422);
    const { error } = errorResponseSchema.parse(response.json());
    expect(error, label).toMatchObject({ code, message: 'Unprocessable Entity' });
    expect('details' in error, label).toBe(false);
    expect(response.body, label).not.toContain('zzzz');
    const line = world.logs.text().slice(logged);
    expect(line, label).toContain(code);
    expect(line, label).not.toContain('zzzz');
  }
});

test('every hostile control name is 422 invalid_name', async () => {
  const { send } = await probeWorld();
  for (const name of HOSTILE_CONTROL_NAMES) {
    const response = await send({ name, email: 'lovelace@example.net' });
    expect(response.statusCode, name).toBe(422);
    expect(errorResponseSchema.parse(response.json()).error.code, name).toBe('invalid_name');
  }
});

test('a body that is not name and address is 400, which is the body schema of the route and not a rule', async () => {
  const { send } = await probeWorld();
  const response = await send({ name: 1, email: 'ada@example.org' });
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('bad_request');
});

test('an error that is not a rule is answered as the application answers it', async () => {
  const { send } = await probeWorld();
  const response = await send({}, '/probe/other-error');
  expect(response.statusCode).toBe(500);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('internal_server_error');
});

test('a rule thrown by name is answered with the status and the code of the table', async () => {
  const { send } = await probeWorld();
  for (const [rule, status] of Object.entries(SIGNER_RULE_STATUS)) {
    const response = await send({ rule }, '/probe/sign-rule');
    expect(response.statusCode, rule).toBe(status);
    expect(errorResponseSchema.parse(response.json()).error.code, rule).toBe(rule);
  }
});
