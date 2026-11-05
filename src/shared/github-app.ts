// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// What the GitHub App of this instance asks for (E19-S06): the permissions and the events of the settings table in
// docs/github-app.md, as the keys GitHub's App manifest and its REST API use. The manifest of the first-run setup is built
// from these values, the check of the permissions an installation grants (E05-S08) reads the same ones, and a test compares
// both with the table of the document, so a permission cannot change without the reason recorded there. This module
// imports neither src/server nor src/web.

/**
 * The permissions of an installation: repository and organisation permissions, which an installation's `permissions` object
 * lists. Each is the lowest level the platform works with (a higher one includes it). Metadata is implicit on every App, pull
 * requests carry the comment, checks carry the Check Run, issues the `/recheck` comment events and members the org-member
 * exemption.
 */
export const INSTALLATION_PERMISSIONS = {
  metadata: 'read',
  pull_requests: 'write',
  checks: 'write',
  issues: 'read',
  members: 'read',
} as const;

/** What the login reads about the person, not about an installation: verified email addresses, with the user's own token. */
const ACCOUNT_PERMISSIONS = { emails: 'read' } as const;

/**
 * What the merge queue support needs (E22-S01): `merge_group` events arrive only once an organisation owner has accepted this
 * permission. It is not in {@link INSTALLATION_PERMISSIONS} on purpose: an installation without it works for pull requests, so the
 * sync must not warn about its absence.
 */
const MERGE_QUEUE_PERMISSIONS = { merge_queues: 'read' } as const;

/** Every permission the App is created with: the `default_permissions` of the manifest. */
export const APP_PERMISSIONS = {
  ...INSTALLATION_PERMISSIONS,
  ...MERGE_QUEUE_PERMISSIONS,
  ...ACCOUNT_PERMISSIONS,
} as const;

/**
 * The events the App subscribes to: the `default_events` of the manifest. `installation`, `installation_repositories` and
 * `github_app_authorization` always arrive and are not subscribed to, so they are not here (the webhook router lists them too).
 */
export const APP_EVENTS = ['pull_request', 'check_run', 'check_suite', 'issue_comment', 'merge_group'] as const;
