// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { delay, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { ManifestConversionFailure } from '../../services/ports/manifest-conversion.ts';
import {
  convertWorld,
  issueManifestState,
  MADE_UP_APP,
  MADE_UP_SECRETS,
  postConvert,
  refusal,
} from './setup-convert-fixture/test-support.ts';

// E19-S11: what each way GitHub can fail becomes, and what it never becomes: GitHub's body. An outage leaves the `state`
// usable so the page can press the button again; any other answer uses the code up.

/** What GitHub's failures say: text and secrets that must reach neither the answer, nor the log. */
const GITHUB_BODY = { message: 'LEAKCANARY-GITHUB-SAID', client_secret: MADE_UP_APP.clientSecret };

/** The App as GitHub answers, for the failures that change one field of it. */
function appAnswer(): Record<string, unknown> {
  return {
    id: MADE_UP_APP.id,
    slug: MADE_UP_APP.slug,
    html_url: MADE_UP_APP.htmlUrl,
    client_id: MADE_UP_APP.clientId,
    client_secret: MADE_UP_APP.clientSecret,
    webhook_secret: MADE_UP_APP.webhookSecret,
    pem: MADE_UP_APP.pem,
  };
}

/** The answer of a failed conversion and the log hold nothing GitHub said. */
function expectNothingOfGithub(texts: readonly string[]): void {
  for (const text of texts) {
    expect(text).not.toContain('LEAKCANARY-GITHUB-SAID');
    for (const secret of MADE_UP_SECRETS) {
      expect(text).not.toContain(secret);
    }
  }
}

test('a code GitHub does not know (404: used, older than an hour, never issued) is 400 setup_code_invalid', async () => {
  const { app, unlocked, github, logs, sessions } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json(GITHUB_BODY, { status: 404 }));
  const response = await postConvert(app, unlocked, state);
  expect(response.statusCode).toBe(400);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('setup_code_invalid');
  expect(response.headers['cache-control']).toBe('no-store');
  expectNothingOfGithub([response.body, logs.text()]);
  expect(sessions.credentialsIssued).toBe(false);
});

test.each([500, 502, 503, 504, 429])(
  'a %s from GitHub is 502 github_unreachable, and the same state and code can be tried again',
  async (status) => {
    const { app, unlocked, github, logs, stateOf, sessions } = await convertWorld();
    const state = await issueManifestState(app, unlocked);
    github.answerNext(() => Response.json(GITHUB_BODY, { status }));
    const response = await postConvert(app, unlocked, state);
    expect(response.statusCode).toBe(502);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('github_unreachable');
    expectNothingOfGithub([response.body, logs.text()]);
    expect(stateOf()).toBe(state);
    expect(sessions.credentialsIssued).toBe(false);
    const retry = await postConvert(app, unlocked, state);
    expect(retry.statusCode).toBe(200);
    expect(github.requests).toHaveLength(2);
  },
);

test('a network error is 502 github_unreachable, and the retry works', async () => {
  const { app, unlocked, github, logs, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  github.answerNext(() => HttpResponse.error());
  expect(await refusal(postConvert(app, unlocked, state))).toEqual([502, 'github_unreachable']);
  expect(stateOf()).toBe(state);
  expectNothingOfGithub([logs.text()]);
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(200);
});

test('a GitHub that does not answer within the timeout is 502 github_unreachable', async () => {
  const { app, unlocked, github, stateOf } = await convertWorld({ githubTimeoutMs: 50 });
  const state = await issueManifestState(app, unlocked);
  github.answerNext(async () => {
    await delay(1000);
    return HttpResponse.json({});
  });
  expect(await refusal(postConvert(app, unlocked, state))).toEqual([502, 'github_unreachable']);
  expect(stateOf()).toBe(state);
});

test.each([
  ['an HTML page', () => new Response('<html>LEAKCANARY-GITHUB-SAID</html>', { status: 201 })],
  ['text that is not JSON', () => new Response('LEAKCANARY-GITHUB-SAID', { status: 201 })],
  ['an empty body', () => new Response(null, { status: 201 })],
  ['a list', () => Response.json([GITHUB_BODY], { status: 201 })],
  ['an object that is not an App', () => Response.json(GITHUB_BODY, { status: 201 })],
  ['an App without its key', () => Response.json({ ...appAnswer(), pem: undefined }, { status: 201 })],
  ['an App whose secret is empty', () => Response.json({ ...appAnswer(), client_secret: '' }, { status: 201 })],
])('%s is 502 github_unexpected_response, and the state is used up', async (_what, answer) => {
  const { app, unlocked, github, logs, stateOf, sessions } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  github.answerNext(answer);
  const response = await postConvert(app, unlocked, state);
  expect(response.statusCode).toBe(502);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('github_unexpected_response');
  expectNothingOfGithub([response.body, logs.text()]);
  expect(stateOf()).toBeUndefined();
  expect(sessions.credentialsIssued).toBe(false);
});

test.each([400, 401, 403, 422])(
  'a %s from GitHub, which the setup has no word for, is 502 github_unexpected_response and uses the state up',
  async (status) => {
    const { app, unlocked, github, logs, stateOf } = await convertWorld();
    const state = await issueManifestState(app, unlocked);
    github.answerNext(() => Response.json(GITHUB_BODY, { status }));
    const response = await postConvert(app, unlocked, state);
    expect([response.statusCode, errorResponseSchema.parse(response.json()).error.code]).toEqual([
      502,
      'github_unexpected_response',
    ]);
    expectNothingOfGithub([response.body, logs.text()]);
    expect(stateOf()).toBeUndefined();
  },
);

test('after a failure that used the state up a new manifest gives the way on, and the conversion then works', async () => {
  const { app, unlocked, github } = await convertWorld();
  const first = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json(GITHUB_BODY, { status: 404 }));
  expect((await postConvert(app, unlocked, first)).statusCode).toBe(400);
  const second = await issueManifestState(app, unlocked);
  expect(second).not.toBe(first);
  expect((await postConvert(app, unlocked, second)).statusCode).toBe(200);
});

test('a failure is not the end of the setup: nothing is recorded as issued and the manifest is still on offer', async () => {
  const { app, unlocked, github, sessions } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json(GITHUB_BODY, { status: 503 }));
  await postConvert(app, unlocked, state);
  expect(sessions.credentialsIssued).toBe(false);
  expect(await issueManifestState(app, unlocked)).toMatch(/^[A-Za-z0-9_-]{43}$/u);
});

test("an error that is not the conversion's own is a plain 500 with the standard envelope, and the state is left as it was", async () => {
  const failing = { convert: () => Promise.reject(new TypeError('something broke')) };
  const { app, unlocked, github, stateOf, sessions } = await convertWorld({ manifestConversion: failing });
  const state = await issueManifestState(app, unlocked);
  const response = await postConvert(app, unlocked, state);
  expect(response.statusCode).toBe(500);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('internal_server_error');
  expect(response.body).not.toContain('something broke');
  expect(stateOf()).toBe(state);
  expect(sessions.credentialsIssued).toBe(false);
  expect(github.requests).toEqual([]);
});

test.each([
  ['code_invalid', 400, 'setup_code_invalid'],
  ['unreachable', 502, 'github_unreachable'],
  ['unexpected_response', 502, 'github_unexpected_response'],
] as const)('the failure %s of the conversion port is %s %s and nothing else', async (reason, status, code) => {
  const failing = { convert: () => Promise.reject(new ManifestConversionFailure(reason)) };
  const { app, unlocked } = await convertWorld({ manifestConversion: failing });
  const state = await issueManifestState(app, unlocked);
  expect(await refusal(postConvert(app, unlocked, state))).toEqual([status, code]);
});
