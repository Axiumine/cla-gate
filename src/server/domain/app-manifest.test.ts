// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { APP_EVENTS, APP_PERMISSIONS } from '../../shared/github-app.ts';
import { LOGIN_CALLBACK_PATH, SETUP_CALLBACK_PATH, WEBHOOK_PATH } from '../../shared/routes.ts';
import { appManifestSchema } from '../../shared/setup.ts';
import { buildAppManifest, manifestActionUrl } from './app-manifest.ts';

// E19-S06: the manifest is built from the shared constants and the address of the instance, and from nothing else.

const STATE = 'S'.repeat(43);
const INPUT = { publicBaseUrl: 'https://cla.example.org', appName: 'CLA Gate', allowOtherAccounts: false };

test('the manifest has the shape of the story, in full', () => {
  expect(buildAppManifest(INPUT)).toEqual({
    name: 'CLA Gate',
    url: 'https://cla.example.org',
    hook_attributes: { url: 'https://cla.example.org/webhooks/github', active: true },
    redirect_url: 'https://cla.example.org/setup/callback',
    callback_urls: ['https://cla.example.org/api/auth/callback'],
    setup_url: 'https://cla.example.org/',
    setup_on_update: false,
    public: false,
    request_oauth_on_install: false,
    default_permissions: {
      metadata: 'read',
      pull_requests: 'write',
      checks: 'write',
      issues: 'read',
      members: 'read',
      emails: 'read',
    },
    default_events: ['pull_request', 'check_run', 'check_suite', 'issue_comment'],
  });
});

test('the paths come from the shared constants: the webhook path ends the hook URL and the login callback is the only callback', () => {
  const manifest = buildAppManifest(INPUT);
  expect(manifest.hook_attributes.url).toBe(`${INPUT.publicBaseUrl}${WEBHOOK_PATH}`);
  expect(manifest.hook_attributes.url.endsWith(WEBHOOK_PATH)).toBe(true);
  expect(manifest.callback_urls).toEqual([`${INPUT.publicBaseUrl}${LOGIN_CALLBACK_PATH}`]);
  expect(manifest.redirect_url).toBe(`${INPUT.publicBaseUrl}${SETUP_CALLBACK_PATH}`);
  expect(manifest.default_permissions).toEqual(APP_PERMISSIONS);
  expect(manifest.default_events).toEqual([...APP_EVENTS]);
});

test('the manifest is what its schema describes, and shares no object with the constants', () => {
  const manifest = buildAppManifest(INPUT);
  expect(appManifestSchema.parse(manifest)).toEqual(manifest);
  manifest.default_events.push('push');
  expect(buildAppManifest(INPUT).default_events).toEqual([...APP_EVENTS]);
});

test.each([
  [true, true],
  [false, false],
])('allowOtherAccounts %s is public %s, and it changes nothing else', (allowOtherAccounts, expected) => {
  const manifest = buildAppManifest({ ...INPUT, allowOtherAccounts });
  expect(manifest.public).toBe(expected);
  expect({ ...manifest, public: false }).toEqual(buildAppManifest(INPUT));
});

test.each([
  ['https://cla.example.org', true],
  ['https://cla.example.org:8443', true],
  ['http://cla.example.org', false],
  ['http://localhost:3000', false],
  ['http://127.0.0.1:3000', false],
])('the webhook of %s is active: %s', (publicBaseUrl, active) => {
  expect(buildAppManifest({ ...INPUT, publicBaseUrl }).hook_attributes.active).toBe(active);
});

test('every address of the manifest starts with the public address', () => {
  const publicBaseUrl = 'https://cla.example.org:8443';
  const manifest = buildAppManifest({ ...INPUT, publicBaseUrl });
  const addresses = [
    manifest.url,
    manifest.hook_attributes.url,
    manifest.redirect_url,
    ...manifest.callback_urls,
    manifest.setup_url,
  ];
  expect(addresses.filter((address) => !address.startsWith(publicBaseUrl))).toEqual([]);
});

test('a personal App is posted to the settings page of the account', () => {
  const owner = { ownerType: 'user', appName: 'x', allowOtherAccounts: false } as const;
  expect(manifestActionUrl(owner, STATE)).toBe(`https://github.com/settings/apps/new?state=${STATE}`);
});

test('an organisation App is posted to the settings page of that organisation', () => {
  const owner = {
    ownerType: 'organisation',
    organisation: 'Acme-Inc',
    appName: 'x',
    allowOtherAccounts: true,
  } as const;
  expect(manifestActionUrl(owner, STATE)).toBe(
    `https://github.com/organizations/Acme-Inc/settings/apps/new?state=${STATE}`,
  );
});
