// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * Where GitHub posts its webhook deliveries (E06-S01). The route, the CSRF exemption (E10), the `webhook` access
 * declaration (E11) and the App manifest (E19) import this constant instead of spelling the path again, so they cannot
 * drift apart.
 */
export const WEBHOOK_PATH = '/webhooks/github';
