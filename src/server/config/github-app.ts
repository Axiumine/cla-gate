// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Logger } from 'pino';
import type { AppConfig } from './env.ts';

/**
 * Says at start-up whether the GitHub App is configured. The GitHub adapter is built only when both the App id and
 * the signing key are set (E05-S01), so a development or test server without credentials still starts. With them, the
 * line carries the App id and the fingerprint of each key, in signing order (current, then previous): the value to
 * compare with the one on the App settings page. The key itself never reaches the log.
 */
export function logGithubApp(logger: Logger, github: AppConfig['github']): void {
  const { appId, privateKey, previousPrivateKey } = github;
  if (appId === undefined || privateKey === undefined) {
    const missing = [
      ...(appId === undefined ? ['GITHUB_APP_ID'] : []),
      ...(privateKey === undefined ? ['GITHUB_APP_PRIVATE_KEY'] : []),
    ];
    // Half a configuration is probably a mistake; none at all is a plain development setup.
    logger[missing.length === 1 ? 'warn' : 'info']({ missing }, 'github.app_not_configured');
    return;
  }
  const keyFingerprints = [privateKey, ...(previousPrivateKey === undefined ? [] : [previousPrivateKey])].map(
    (key) => key.fingerprint,
  );
  logger.info({ appId, keyFingerprints }, 'github.app_configured');
}
