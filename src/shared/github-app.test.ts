// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { APP_EVENTS, APP_PERMISSIONS, INSTALLATION_PERMISSIONS } from './github-app.ts';

// E19-S06: the permissions and events the App is created with. The server tests compare them with docs/github-app.md.

test('the permissions of the App are the five of an installation, the merge queues (E22-S01) and the email addresses of the login, with their levels', () => {
  expect(APP_PERMISSIONS).toEqual({
    metadata: 'read',
    pull_requests: 'write',
    checks: 'write',
    issues: 'read',
    members: 'read',
    merge_queues: 'read',
    emails: 'read',
  });
});

test('an installation reports the five permissions pull requests need: the merge queues and the person email addresses are no minimum, so an installation without them is not warned about', () => {
  expect(Object.keys(INSTALLATION_PERMISSIONS)).toEqual(['metadata', 'pull_requests', 'checks', 'issues', 'members']);
  expect(Object.keys(APP_PERMISSIONS).filter((name) => !(name in INSTALLATION_PERMISSIONS))).toEqual([
    'merge_queues',
    'emails',
  ]);
});

test('the App subscribes to the four events of pull request checks and to merge_group, and not to those that always arrive', () => {
  expect(APP_EVENTS).toEqual(['pull_request', 'check_run', 'check_suite', 'issue_comment', 'merge_group']);
});
