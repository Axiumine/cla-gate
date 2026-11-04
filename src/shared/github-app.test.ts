// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { APP_EVENTS, APP_PERMISSIONS, INSTALLATION_PERMISSIONS } from './github-app.ts';

// E19-S06: the permissions and events the App is created with. The server tests compare them with docs/github-app.md.

test('the permissions of the App are the five of an installation and the email addresses of the login, with their levels', () => {
  expect(APP_PERMISSIONS).toEqual({
    metadata: 'read',
    pull_requests: 'write',
    checks: 'write',
    issues: 'read',
    members: 'read',
    emails: 'read',
  });
});

test('an installation reports every permission of the App but the one that belongs to the person, and in the order of the warning', () => {
  expect(Object.keys(INSTALLATION_PERMISSIONS)).toEqual(['metadata', 'pull_requests', 'checks', 'issues', 'members']);
  expect(Object.keys(APP_PERMISSIONS).filter((name) => !(name in INSTALLATION_PERMISSIONS))).toEqual(['emails']);
});

test('the App subscribes to the four events of pull request checks, and not to those that always arrive', () => {
  expect(APP_EVENTS).toEqual(['pull_request', 'check_run', 'check_suite', 'issue_comment']);
});
