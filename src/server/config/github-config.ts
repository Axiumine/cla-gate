// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { GithubVariables } from './env-github.ts';
import type { GitHubPrivateKey } from './github-key.ts';
import type { Secret } from './secret.ts';

/**
 * The GitHub App settings the server reads (see docs/configuration.md). The App id, key and webhook secret are required
 * in production; the client id and secret are placeholders for the slices that use them.
 */
export interface GithubConfig {
  readonly appId: string | undefined;
  /** The signing key. With {@link previousPrivateKey}, the key list of the JWT signer (E05-S02): current first. */
  readonly privateKey: GitHubPrivateKey | undefined;
  /** The key kept during a rotation; never equal to {@link privateKey}. */
  readonly previousPrivateKey: GitHubPrivateKey | undefined;
  /**
   * The numeric ids of the accounts the instance serves besides the App owner's (E05-S07); empty when unset. The
   * admission policy adds the owner once the self-check has named it.
   */
  readonly allowedAccountIds: readonly GithubId[];
  /** Signs every webhook delivery (E06-S01); at least 16 characters. */
  readonly webhookSecret: Secret | undefined;
  /** The secret kept during a rotation: a delivery signed with it is still accepted; never equal to {@link webhookSecret}. */
  readonly previousWebhookSecret: Secret | undefined;
  readonly clientId: string | undefined;
  readonly clientSecret: Secret | undefined;
}

/** The validated GitHub variables, as the settings the rest of the server reads. */
export function toGithubConfig(env: GithubVariables): GithubConfig {
  return {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    previousPrivateKey: env.GITHUB_APP_PRIVATE_KEY_PREVIOUS,
    allowedAccountIds: env.GITHUB_ALLOWED_ACCOUNT_IDS ?? [],
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    previousWebhookSecret: env.GITHUB_WEBHOOK_SECRET_PREVIOUS,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}
