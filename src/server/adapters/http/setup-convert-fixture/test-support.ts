// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { onTestFinished } from 'vitest';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import { manifestResponseSchema } from '../../../../shared/setup.ts';
import { FakeClock } from '../../../services/test-support.ts';
import type { TestAppOptions } from '../../../test-support.ts';
import {
  MANIFEST_BODY,
  postManifest,
  SETUP_ORIGIN,
  setupApp,
  type Unlocked,
  unlockSetup,
} from '../setup-fixture/test-support.ts';
import { createSetupSessions } from '../setup-sessions.ts';

// A GitHub that answers the manifest conversion (E19-S11) the way the real one does, and the calls of a browser that runs the
// flow against it. GitHub answers `201` with the App and its credentials, once per code; a code it did not issue, or that was
// converted already, is a `404`. Everything here is made up.

/** The one-time code GitHub put in the address of the setup page: letters and digits, as the real ones are. */
export const FAKE_CODE = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

/**
 * What the conversion hands out. Every value is made up and distinct, so a test can look for each one on its own anywhere a
 * secret could leak to.
 */
export const MADE_UP_APP = {
  id: 987_654,
  slug: 'cla-gate-made-up',
  htmlUrl: 'https://github.com/apps/cla-gate-made-up',
  clientId: 'Iv1.made-up-client-id-0001',
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
  clientSecret: 'made-up-client-secret-VALUE-0002',
  // nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
  webhookSecret: 'made-up-webhook-secret-VALUE-0003',
  pem: '-----BEGIN RSA PRIVATE KEY-----\nmade-up-private-key-VALUE-0004\n-----END RSA PRIVATE KEY-----\n',
} as const;

/** The three values only the operator may ever see, as they are in GitHub's answer. */
export const MADE_UP_SECRETS: readonly string[] = [
  MADE_UP_APP.clientSecret,
  MADE_UP_APP.webhookSecret,
  MADE_UP_APP.pem,
];

/** What GitHub's `201` carries: the fields the setup reads and, as the real answer does, many it does not. */
function conversionBody(): Record<string, unknown> {
  return {
    id: MADE_UP_APP.id,
    slug: MADE_UP_APP.slug,
    node_id: 'MDM6QXBwOTg3NjU0',
    owner: { login: 'made-up-owner', id: 4321, type: 'User' },
    name: 'CLA Gate made-up',
    description: null,
    external_url: SETUP_ORIGIN,
    html_url: MADE_UP_APP.htmlUrl,
    created_at: '2026-11-04T09:00:00Z',
    updated_at: '2026-11-04T09:00:00Z',
    permissions: { metadata: 'read', checks: 'write' },
    events: ['pull_request'],
    client_id: MADE_UP_APP.clientId,
    client_secret: MADE_UP_APP.clientSecret,
    webhook_secret: MADE_UP_APP.webhookSecret,
    pem: MADE_UP_APP.pem,
  };
}

/** One request GitHub received. */
interface SentConversion {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** A response, or a promise of one: what the next call answers with instead of the usual. */
type Answer = () => Response | Promise<Response>;

export interface FakeManifestGithub {
  /** Every request that reached GitHub, in order. */
  readonly requests: SentConversion[];
  /** The next call answers with this instead of the usual, once; answers queue in the order they were given. */
  answerNext(answer: Answer): void;
  /** The codes that were converted. */
  readonly converted: string[];
}

/** Starts the mocked GitHub for the rest of the test; a request to any other address fails the test. */
export function fakeManifestGithub(): FakeManifestGithub {
  const requests: SentConversion[] = [];
  const converted: string[] = [];
  const queued: Answer[] = [];
  const server = setupServer(
    http.post('https://api.github.com/app-manifests/:code/conversions', async ({ request, params }) => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.text(),
      });
      const queuedAnswer = queued.shift();
      if (queuedAnswer !== undefined) {
        return queuedAnswer();
      }
      if (params['code'] !== FAKE_CODE || converted.includes(FAKE_CODE)) {
        return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
      }
      converted.push(FAKE_CODE);
      return HttpResponse.json(conversionBody(), { status: 201 });
    }),
  );
  server.listen({ onUnhandledFrame: 'error' });
  onTestFinished(() => {
    server.close();
  });
  return { requests, converted, answerNext: (answer) => queued.push(answer) };
}

/** What a setup `POST /api/setup/convert` carries when nothing is taken away; each part can be changed or dropped. */
export interface ConvertCall {
  readonly body?: string | object;
  /** Leave a header out with `undefined`, or send another value. */
  readonly origin?: string | undefined;
  readonly cookie?: string | undefined;
  readonly csrfToken?: string | undefined;
}

/** `POST /api/setup/convert` as the setup page sends it after GitHub's round trip. */
export function postConvert(app: FastifyInstance, unlocked: Unlocked, state: string, call: Partial<ConvertCall> = {}) {
  const headers = {
    origin: 'origin' in call ? call.origin : SETUP_ORIGIN,
    cookie: 'cookie' in call ? call.cookie : unlocked.cookie,
    'x-csrf-token': 'csrfToken' in call ? call.csrfToken : unlocked.csrfToken,
  };
  return app.inject({
    method: 'POST',
    url: '/api/setup/convert',
    headers: Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined)),
    payload: 'body' in call ? call.body : { code: FAKE_CODE, state },
  });
}

/** The `state` of a manifest the unlocked browser asked for: the first half of the flow, which the conversion completes. */
export async function issueManifestState(app: FastifyInstance, unlocked: Unlocked): Promise<string> {
  return manifestResponseSchema.parse((await postManifest(app, unlocked, { body: MANIFEST_BODY })).json()).state;
}

/** The id of the session in a `Cookie` header value. */
export const idOf = (cookie: string): string => cookie.slice(cookie.indexOf('=') + 1);

/** The status and the code of an error answer: what a page tells the person, and nothing of how the server got there. */
export async function refusal(response: ReturnType<typeof postConvert>): Promise<[number, string]> {
  const settled = await response;
  return [settled.statusCode, errorResponseSchema.parse(settled.json()).error.code];
}

/**
 * The app in setup mode with a GitHub to talk to, one browser that unlocked it, and the store of sessions to read what the
 * routes did to it (`stateOf`): the state of the world every test of the conversion starts from.
 */
export async function convertWorld(options: Omit<TestAppOptions, 'setupSessions' | 'clock'> = {}) {
  const clock = new FakeClock('2026-11-04T09:00:00.000Z');
  const sessions = createSetupSessions(clock);
  const github = fakeManifestGithub();
  const { app, logs } = await setupApp({ ...options, clock, setupSessions: sessions });
  const unlocked = await unlockSetup(app);
  return {
    app,
    logs,
    sessions,
    github,
    unlocked,
    /** The `state` the session of `who` holds now: the last one issued and not used up, or undefined. */
    stateOf: (who: Unlocked = unlocked): string | undefined => sessions.find(idOf(who.cookie))?.state,
  };
}
