// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * Where GitHub posts its webhook deliveries (E06-S01). The route, the CSRF exemption (E10), the `webhook` access
 * declaration (E11) and the App manifest (E19) import this constant instead of spelling the path again, so they cannot
 * drift apart.
 */
export const WEBHOOK_PATH = '/webhooks/github';

/**
 * Where GitHub sends the browser back to after the authorization page of the login (E10-S04). The route of the callback
 * (E10-S05), the `redirect_uri` of the login, the Callback URL of the GitHub App (`callbackUrl`) and the App manifest
 * (E19-S06) import this constant instead of spelling the path again, so they cannot drift apart.
 */
export const LOGIN_CALLBACK_PATH = '/api/auth/callback';

/**
 * The page of the first-run setup (E19-S07), a page of the single-page app and not an API route. While the GitHub App is
 * configured the server answers `404` for it and for everything below it.
 */
export const SETUP_PATH = '/setup';

/**
 * Where GitHub sends the browser back to once the App is created from the manifest (E19-S06): below {@link SETUP_PATH}, a page
 * of the single-page app too. It is the `redirect_url` of the manifest.
 */
export const SETUP_CALLBACK_PATH = `${SETUP_PATH}/callback`;
