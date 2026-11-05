// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import { manifestResponseSchema } from '../../../shared/setup.ts';
import { FakeClock } from '../../services/test-support.ts';
import { MANIFEST_BODY, postManifest, SETUP_ORIGIN, setupApp, unlockSetup } from './setup-fixture/test-support.ts';
import { createSetupSessions } from './setup-sessions.ts';

// E19-S06: `POST /api/setup/manifest` answers with the manifest, the address to post it to and a `state` bound to the
// session. Hostile input is a 400 before anything is built.

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/u;

/** The id of the session in a `Cookie` header value. */
const idOf = (cookie: string): string => cookie.slice(cookie.indexOf('=') + 1);

test("a personal App: the address is GitHub's page for a user and the manifest is the one of the story, built for this instance", async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const response = await postManifest(app, unlocked, { body: MANIFEST_BODY });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const { actionUrl, manifest, state } = manifestResponseSchema.parse(response.json());
  expect(state).toMatch(BASE64URL_43);
  expect(actionUrl).toBe(`https://github.com/settings/apps/new?state=${state}`);
  expect(manifest).toEqual({
    name: 'CLA Gate cla-example-org',
    url: SETUP_ORIGIN,
    hook_attributes: { url: `${SETUP_ORIGIN}/webhooks/github`, active: true },
    redirect_url: `${SETUP_ORIGIN}/setup/callback`,
    callback_urls: [`${SETUP_ORIGIN}/api/auth/callback`],
    setup_url: `${SETUP_ORIGIN}/`,
    setup_on_update: false,
    public: false,
    request_oauth_on_install: false,
    default_permissions: {
      metadata: 'read',
      pull_requests: 'write',
      checks: 'write',
      issues: 'read',
      members: 'read',
      merge_queues: 'read',
      emails: 'read',
    },
    default_events: ['pull_request', 'check_run', 'check_suite', 'issue_comment', 'merge_group'],
  });
});

test('an organisation App: the address is the settings page of that organisation', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const body = { ownerType: 'organisation', organisation: 'Acme-Inc', appName: 'Acme CLA', allowOtherAccounts: false };
  const { actionUrl, state } = manifestResponseSchema.parse((await postManifest(app, unlocked, { body })).json());
  expect(actionUrl).toBe(`https://github.com/organizations/Acme-Inc/settings/apps/new?state=${state}`);
});

test.each([
  [false, false],
  [true, true],
])('allowOtherAccounts %s makes the App public: %s', async (allowOtherAccounts, expected) => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const body = { ...MANIFEST_BODY, allowOtherAccounts };
  expect(manifestResponseSchema.parse((await postManifest(app, unlocked, { body })).json()).manifest.public).toBe(
    expected,
  );
});

test('the name in the manifest is the name asked for, and nothing else comes from the body', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const body = { ownerType: 'user', appName: 'My CLA-Gate 2', allowOtherAccounts: true };
  const { manifest } = manifestResponseSchema.parse((await postManifest(app, unlocked, { body })).json());
  expect(manifest.name).toBe('My CLA-Gate 2');
  expect(manifest.url).toBe(SETUP_ORIGIN);
});

test('over plain http the webhook is inactive, because GitHub cannot reach a development server', async () => {
  const { app } = await setupApp({ env: { PUBLIC_BASE_URL: 'http://localhost:3000' } });
  const unlocked = await unlockSetup(app);
  const response = await postManifest(app, unlocked, { origin: 'http://localhost:3000' });
  const { manifest } = manifestResponseSchema.parse(response.json());
  expect(manifest.hook_attributes).toEqual({ url: 'http://localhost:3000/webhooks/github', active: false });
  expect(manifest.callback_urls).toEqual(['http://localhost:3000/api/auth/callback']);
});

test('every call gets a state of its own, 256 random bits, also within one session', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const other = await unlockSetup(app);
  const states = new Set<string>();
  for (const session of [unlocked, unlocked, other]) {
    states.add(manifestResponseSchema.parse((await postManifest(app, session)).json()).state);
  }
  expect(states.size).toBe(3);
});

test('the state belongs to the session that asked: the last one issued replaces the one before', async () => {
  const sessions = createSetupSessions(new FakeClock('2026-11-03T09:00:00.000Z'));
  const { app } = await setupApp({ setupSessions: sessions });
  const first = await unlockSetup(app);
  const second = await unlockSetup(app);
  expect(sessions.find(idOf(first.cookie))?.state).toBeUndefined();
  const one = manifestResponseSchema.parse((await postManifest(app, first)).json()).state;
  const two = manifestResponseSchema.parse((await postManifest(app, first)).json()).state;
  const other = manifestResponseSchema.parse((await postManifest(app, second)).json()).state;
  expect(sessions.find(idOf(first.cookie))?.state).toBe(two);
  expect(sessions.find(idOf(second.cookie))?.state).toBe(other);
  expect([one, two, other]).toHaveLength(new Set([one, two, other]).size);
});

const HOSTILE_ORGANISATIONS = [
  ['a slash', 'acme/evil'],
  ['dot dot', '..'],
  ['a path with dot dot', '../../evil'],
  ['a query', 'acme?state=x'],
  ['a fragment', 'acme#x'],
  ['a percent escape', 'acme%2Fevil'],
  ['unicode letters', 'acmé'],
  ['a right-to-left override', `acme${String.fromCodePoint(0x202e)}evil`],
  ['HTML', '<img src=x onerror=alert(1)>'],
  ['a space', 'acme inc'],
  ['a line feed', 'acme\nevil'],
  ['a leading hyphen', '-acme'],
  ['a trailing hyphen', 'acme-'],
  ['40 characters', 'a'.repeat(40)],
  ['nothing', ''],
] as const;

test.each(HOSTILE_ORGANISATIONS)(
  'an organisation login with %s is 400 and builds nothing',
  async (_what, organisation) => {
    const sessions = createSetupSessions(new FakeClock('2026-11-03T09:00:00.000Z'));
    const { app } = await setupApp({ setupSessions: sessions });
    const unlocked = await unlockSetup(app);
    const body = { ownerType: 'organisation', organisation, appName: 'Acme CLA', allowOtherAccounts: false };
    const response = await postManifest(app, unlocked, { body });
    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('bad_request');
    expect(sessions.find(idOf(unlocked.cookie))?.state).toBeUndefined();
  },
);

const HOSTILE_NAMES = [
  ['a slash', 'a/b'],
  ['dot dot', '..'],
  ['a question mark', 'a?b'],
  ['a hash', 'a#b'],
  ['an accent', 'café'],
  ['an emoji', 'cla \u{1F680}'],
  ['HTML', '<script>alert(1)</script>'],
  ['quotes', '"quoted"'],
  ['an apostrophe', "o'neil"],
  ['a full stop', 'cla.gate'],
  ['a line feed', 'a\nb'],
  ['35 characters', 'a'.repeat(35)],
  ['nothing', ''],
] as const;

test.each(HOSTILE_NAMES)('an App name with %s is 400 and builds nothing', async (_what, appName) => {
  const sessions = createSetupSessions(new FakeClock('2026-11-03T09:00:00.000Z'));
  const { app } = await setupApp({ setupSessions: sessions });
  const unlocked = await unlockSetup(app);
  const response = await postManifest(app, unlocked, { body: { ...MANIFEST_BODY, appName } });
  expect(response.statusCode).toBe(400);
  expect(sessions.find(idOf(unlocked.cookie))?.state).toBeUndefined();
});

test.each([
  ['an owner type of neither kind', { ...MANIFEST_BODY, ownerType: 'team' }],
  ['an organisation owner with no login', { ...MANIFEST_BODY, ownerType: 'organisation' }],
  ['a personal owner that names an organisation', { ...MANIFEST_BODY, organisation: 'acme' }],
  ['no allowOtherAccounts', { ownerType: 'user', appName: 'CLA Gate' }],
  ['allowOtherAccounts as a string', { ...MANIFEST_BODY, allowOtherAccounts: 'true' }],
  ['no name', { ownerType: 'user', allowOtherAccounts: false }],
  ['a key besides the four', { ...MANIFEST_BODY, public: true }],
  ['a list', [MANIFEST_BODY]],
  ['an empty object', {}],
])('a body with %s is 400', async (_what, body) => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  expect((await postManifest(app, unlocked, { body })).statusCode).toBe(400);
});

test.each([
  [
    'an organisation login of one character',
    { ownerType: 'organisation', organisation: 'a', appName: 'x', allowOtherAccounts: false },
  ],
  [
    'an organisation login of 39 characters with hyphens inside',
    { ownerType: 'organisation', organisation: `a${'-b'.repeat(18)}c`, appName: 'x', allowOtherAccounts: true },
  ],
  ['a name of 34 characters', { ...MANIFEST_BODY, appName: 'a'.repeat(34) }],
  ['a name with spaces and hyphens', { ...MANIFEST_BODY, appName: 'Cla - Gate 2 -' }],
])('%s is accepted', async (_what, body) => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  expect((await postManifest(app, unlocked, { body })).statusCode).toBe(200);
});

test('the body limit is 4 KiB: a larger body is 413 before it is read', async () => {
  const { app } = await setupApp();
  const unlocked = await unlockSetup(app);
  const body = { ...MANIFEST_BODY, appName: 'a'.repeat(4096) };
  const response = await postManifest(app, unlocked, { body });
  expect(response.statusCode).toBe(413);
  expect(errorResponseSchema.parse(response.json()).error.code).toBe('payload_too_large');
});

test('nothing of the flow is logged: not the state, not the CSRF token, not the session id', async () => {
  const { app, logs } = await setupApp();
  const unlocked = await unlockSetup(app);
  const { state } = manifestResponseSchema.parse((await postManifest(app, unlocked)).json());
  await postManifest(app, unlocked, { csrfToken: 'LEAKCANARY-csrf' });
  expect(logs.text()).not.toContain(state);
  expect(logs.text()).not.toContain(unlocked.csrfToken);
  expect(logs.text()).not.toContain(idOf(unlocked.cookie));
  expect(logs.text()).not.toContain('LEAKCANARY');
});
