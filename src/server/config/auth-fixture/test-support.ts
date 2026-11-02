// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The login settings of E10-S01 as a test environment holds them. Made-up values only: nothing here is, or looks like, a
// real secret.

/** The session secret of a test: 32 characters, the least the configuration accepts. */
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
export const TEST_SESSION_SECRET = 'test-session-secret-0123456789ab';
export const TEST_CLIENT_ID = 'Iv1.test-client-id';
// nosemgrep: ajinabraham.njsscan.generic.hardcoded_secrets.node_secret -- made-up value for the tests, not a credential
export const TEST_CLIENT_SECRET = 'test-client-secret-value';

/** The three variables production requires for login, so a test about something else can still be production. */
export const AUTH_ENV: Readonly<Record<string, string>> = {
  SESSION_SECRET: TEST_SESSION_SECRET,
  GITHUB_CLIENT_ID: TEST_CLIENT_ID,
  GITHUB_CLIENT_SECRET: TEST_CLIENT_SECRET,
};
