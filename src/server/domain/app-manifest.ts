// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { APP_EVENTS, APP_PERMISSIONS } from '../../shared/github-app.ts';
import { LOGIN_CALLBACK_PATH, SETUP_CALLBACK_PATH, WEBHOOK_PATH } from '../../shared/routes.ts';
import type { AppManifest, ManifestRequest } from '../../shared/setup.ts';

// The GitHub App manifest of the first-run setup (E19-S06), and the address it is posted to. Pure: every path, permission and
// event is a shared constant, and the only values that vary are the public address of the instance and the two answers of
// the operator, both already validated by the request schema (`manifestRequestSchema`).

/** What the manifest is built from. */
export interface ManifestInput {
  /** `PUBLIC_BASE_URL`: an origin without a trailing slash. */
  readonly publicBaseUrl: string;
  /** The App's name, as the request schema accepted it. */
  readonly appName: string;
  /** Whether accounts other than the owner may install the App: a private App can be installed by its owner only. */
  readonly allowOtherAccounts: boolean;
}

/**
 * The manifest GitHub turns into an App. `public` follows `allowOtherAccounts` alone. The webhook is switched off when the
 * instance is not on `https`: GitHub cannot reach a development server, and its manifest page would refuse an address it
 * cannot deliver to as active.
 */
export function buildAppManifest(input: ManifestInput): AppManifest {
  const base = input.publicBaseUrl;
  return {
    name: input.appName,
    url: base,
    hook_attributes: { url: `${base}${WEBHOOK_PATH}`, active: base.startsWith('https://') },
    redirect_url: `${base}${SETUP_CALLBACK_PATH}`,
    callback_urls: [`${base}${LOGIN_CALLBACK_PATH}`],
    setup_url: `${base}/`,
    setup_on_update: false,
    public: input.allowOtherAccounts,
    request_oauth_on_install: false,
    default_permissions: { ...APP_PERMISSIONS },
    default_events: [...APP_EVENTS],
  };
}

/**
 * The address the manifest is posted to: GitHub's page for a new App under a personal account, or under the organisation
 * the request names, with `state` in the query. `owner` has passed the request schema, so the organisation is a GitHub
 * login and `state` is base64url: neither can add a path segment, a query or a fragment.
 */
export function manifestActionUrl(owner: ManifestRequest, state: string): string {
  const page =
    owner.ownerType === 'organisation' ? `organizations/${owner.organisation}/settings/apps/new` : 'settings/apps/new';
  return `https://github.com/${page}?state=${state}`;
}
