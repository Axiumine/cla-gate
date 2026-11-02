// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, onTestFinished, test } from 'vitest';
import { WEBHOOK_PATH } from '../../../shared/routes.ts';
import { TENANT } from '../../services/tenant-fixture/test-support.ts';
import { FIXTURE_IDS, webhookFixture, withValue } from '../github/webhook-fixture/test-support.ts';
import { WEBHOOK_BODY_LIMIT } from './limits.ts';
import { deliveryHeaders, SECRET_CURRENT, SECRET_PREVIOUS, sharedTenantWebhookApp, sign } from './test-support.ts';

// The log of the whole hostile suite (E06-S07): hostile deliveries of every kind go through the route, and the pino
// output they leave holds no fragment of a body, no value of a header, no signature, neither webhook secret and no client
// address. Every value that must not appear is a canary, so a leak is a failed `not.toContain`, not a judgement.

const ENV = {
  GITHUB_WEBHOOK_SECRET: SECRET_CURRENT,
  GITHUB_WEBHOOK_SECRET_PREVIOUS: SECRET_PREVIOUS,
  GITHUB_APP_ID: String(FIXTURE_IDS.app),
};
const BODY_CANARY = 'body-canary-6d2f91c7';
const HEADER_CANARY = 'header-canary-3b7e40a1';
const ADDRESS = '198.51.100.23';
const IMPOSTOR = 'a-secret-nobody-configured-9e8d7c';

interface Hostile {
  readonly label: string;
  readonly status: number;
  /** What the `webhook.received` line says it became. */
  readonly outcome: 'accepted' | 'ignored' | 'rejected';
  readonly body: Buffer | string;
  /** Replaces the headers of a correctly signed delivery of `event`; `undefined` removes the header. */
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly event?: string;
  readonly signedWith?: string;
}

const pullRequest = (changes: readonly (readonly [string, unknown])[] = []) =>
  JSON.stringify(
    changes.reduce((payload, [path, value]) => withValue(payload, path, value), webhookFixture('pull_request')),
  );

const HOSTILE: readonly Hostile[] = [
  {
    label: 'a valid delivery full of canaries in the fields the schema strips',
    status: 202,
    outcome: 'accepted',
    body: pullRequest([
      ['pull_request.title', BODY_CANARY],
      ['repository.full_name', `${BODY_CANARY}/${BODY_CANARY}`],
      ['sender.login', BODY_CANARY],
    ]),
    event: 'pull_request',
  },
  {
    label: 'a valid delivery signed with the previous secret',
    status: 202,
    outcome: 'accepted',
    body: pullRequest([['pull_request.title', BODY_CANARY]]),
    event: 'pull_request',
    signedWith: SECRET_PREVIOUS,
    headers: { 'x-github-delivery': '0f1e2d3c-4b5a-4968-8776-655443322110' },
  },
  {
    label: 'a comment that asks for a recheck and carries a canary',
    status: 202,
    outcome: 'accepted',
    body: JSON.stringify(withValue(webhookFixture('issue_comment'), 'comment.body', `/recheck ${BODY_CANARY}`)),
    event: 'issue_comment',
    headers: { 'x-github-delivery': '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' },
  },
  {
    label: 'a pull request of a rejected installation',
    status: 202,
    outcome: 'ignored',
    body: pullRequest([
      ['installation.id', TENANT.rejected.installation],
      ['repository.id', TENANT.rejected.repository],
      ['pull_request.title', BODY_CANARY],
    ]),
    event: 'pull_request',
    headers: { 'x-github-delivery': '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e' },
  },
  {
    label: 'an action that is a canary',
    status: 202,
    outcome: 'ignored',
    body: pullRequest([['action', BODY_CANARY]]),
    event: 'pull_request',
    headers: { 'x-github-delivery': '3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f' },
  },
  {
    label: 'a payload whose id is a canary',
    status: 400,
    outcome: 'rejected',
    body: pullRequest([['installation.id', BODY_CANARY]]),
    event: 'pull_request',
  },
  { label: 'a body that is not JSON', status: 400, outcome: 'rejected', body: `{"title":"${BODY_CANARY}"` },
  {
    label: 'a body that is not UTF-8',
    status: 400,
    outcome: 'rejected',
    body: Buffer.from([0x7b, 0x22, 0xff, 0xfe, ...Buffer.from(BODY_CANARY)]),
  },
  { label: 'a JSON array', status: 400, outcome: 'rejected', body: `["${BODY_CANARY}"]` },
  {
    label: 'a body signed by a secret nobody configured',
    status: 401,
    outcome: 'rejected',
    body: pullRequest([['pull_request.title', BODY_CANARY]]),
    event: 'pull_request',
    signedWith: IMPOSTOR,
  },
  {
    label: 'a signature that is a canary',
    status: 401,
    outcome: 'rejected',
    body: BODY_CANARY,
    headers: { 'x-hub-signature-256': `sha256=${HEADER_CANARY}` },
  },
  {
    label: 'a signature header of the legacy kind only',
    status: 401,
    outcome: 'rejected',
    body: BODY_CANARY,
    headers: { 'x-hub-signature-256': undefined, 'x-hub-signature': `sha1=${HEADER_CANARY}` },
  },
  {
    label: 'an event header that is a canary',
    status: 400,
    outcome: 'rejected',
    body: pullRequest(),
    headers: { 'x-github-event': HEADER_CANARY.toUpperCase() },
  },
  {
    label: 'a delivery header that is a canary',
    status: 400,
    outcome: 'rejected',
    body: pullRequest(),
    headers: { 'x-github-delivery': HEADER_CANARY },
  },
  {
    label: 'a content type that is a canary',
    status: 415,
    outcome: 'rejected',
    body: pullRequest(),
    headers: { 'content-type': `text/plain; boundary=${HEADER_CANARY}` },
  },
  {
    label: 'a target id that is a canary',
    status: 400,
    outcome: 'rejected',
    body: pullRequest(),
    headers: { 'x-github-hook-installation-target-id': HEADER_CANARY },
  },
  {
    label: 'a valid delivery with canaries in the headers a log might copy',
    status: 202,
    outcome: 'accepted',
    body: pullRequest(),
    event: 'pull_request',
    headers: {
      'x-github-delivery': '4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80',
      'user-agent': HEADER_CANARY,
      authorization: `Bearer ${HEADER_CANARY}`,
      cookie: `session=${HEADER_CANARY}`,
      referer: `https://${HEADER_CANARY}.example.test/`,
      'x-forwarded-for': `${HEADER_CANARY}, ${ADDRESS}`,
      'x-request-id': HEADER_CANARY,
    },
  },
  {
    label: 'a body over the limit that starts with a canary',
    status: 413,
    outcome: 'rejected',
    body: `{"${BODY_CANARY}":"${'a'.repeat(WEBHOOK_BODY_LIMIT)}"}`,
    headers: { 'x-github-delivery': '5e6f7a8b-9c0d-4e1f-8a3b-4c5d6e7f8091' },
  },
];

async function sendAll(server: Awaited<ReturnType<typeof sharedTenantWebhookApp>>) {
  const answered: [string, number][] = [];
  const bodies: string[] = [];
  const headers: string[] = [];
  for (const hostile of HOSTILE) {
    const signed = deliveryHeaders(hostile.body, {
      signature: sign(hostile.signedWith ?? SECRET_CURRENT, hostile.body),
      headers: { 'x-github-event': hostile.event ?? 'ping', ...hostile.headers },
    });
    const response = await server.app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      headers: signed,
      payload: hostile.body,
      remoteAddress: ADDRESS,
    });
    answered.push([hostile.label, response.statusCode]);
    bodies.push(response.body);
    headers.push(JSON.stringify(response.headers));
  }
  return { answered, text: [...bodies, ...headers].join('\n') };
}

/** The signatures a log could leak: the hex that was sent in each request, and the hex the server computed for it. */
function signaturesOf(): string[] {
  return HOSTILE.flatMap((hostile) =>
    [SECRET_CURRENT, SECRET_PREVIOUS, IMPOSTOR].map((secret) => sign(secret, hostile.body).slice('sha256='.length)),
  );
}

test('the log of the whole hostile suite holds no body fragment, no header value, no signature, no secret and no address', async () => {
  const server = await sharedTenantWebhookApp(ENV);
  onTestFinished(() => server.app.close());
  const { answered, text } = await sendAll(server);
  expect(answered).toEqual(HOSTILE.map((hostile) => [hostile.label, hostile.status]));

  const written = server.logs.text();
  const fromResponses = text;
  const forbidden = [
    BODY_CANARY,
    HEADER_CANARY,
    HEADER_CANARY.toUpperCase(),
    SECRET_CURRENT,
    SECRET_PREVIOUS,
    IMPOSTOR,
    ADDRESS,
    ...signaturesOf(),
  ];
  for (const value of forbidden) {
    expect(written, `the log holds ${value.slice(0, 12)}...`).not.toContain(value);
    expect(fromResponses, `a response holds ${value.slice(0, 12)}...`).not.toContain(value);
  }

  // One line per delivery, for the refused ones too, and nothing but numbers and constants in it.
  const received = server.logs.lines().filter((line) => line['msg'] === 'webhook.received');
  expect(received).toHaveLength(HOSTILE.length);
  expect(received.map((line) => line['outcome'])).toEqual(HOSTILE.map((hostile) => hostile.outcome));
  // The rotation warning is there, and it is a constant too.
  expect(server.logs.lines().filter((line) => line['msg'] === 'webhook.secret_previous_used')).toHaveLength(1);
});

test('the log of an address that is held back for too many failures does not hold the address either', async () => {
  const server = await sharedTenantWebhookApp(ENV);
  onTestFinished(() => server.app.close());
  const body = pullRequest();
  for (let attempt = 0; attempt < 35; attempt += 1) {
    await server.app.inject({
      method: 'POST',
      url: WEBHOOK_PATH,
      headers: deliveryHeaders(body, { signature: sign(IMPOSTOR, body) }),
      payload: body,
      remoteAddress: ADDRESS,
    });
  }
  const written = server.logs.text();
  expect(written).not.toContain(ADDRESS);
  expect(written).not.toContain(IMPOSTOR);
  const received = server.logs.lines().filter((line) => line['msg'] === 'webhook.received');
  expect(received).toHaveLength(35);
  expect(received.slice(-5).map((line) => line['reason'])).toEqual(
    Array.from({ length: 5 }, () => 'webhook_throttled'),
  );
});
