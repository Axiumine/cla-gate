// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { generateKeyPairSync } from 'node:crypto';
import type { Change } from './reconfigure.ts';

// E19-S12: the credentials of a GitHub App that does not exist, for the scenario that starts the stack in configured mode. The
// application reads five values (App id, private key, webhook secret, client id, client secret) and takes the mode from their
// presence; none of them is checked against GitHub except by the start-up self-check, which the scenario keeps from reaching
// GitHub (the override of its `app` service, tests/smoke/configured.test.ts). The values are made up for every run and written
// into the stack's own temporary directory only.

/** The size GitHub requires of an App's key, and the application checks (src/server/config/github-key.ts). */
const KEY_BITS = 2048;
const APP_ID_MIN = 100_000;
const APP_ID_SPAN = 900_000;
const SECRET_BYTES = 16;

/**
 * The dotenv lines and the secret files that make the stack configured. `randomHex` is the random source of the harness; the
 * App id is a number of six digits taken from it as well. The private key is a fresh RSA key, PKCS#8 in PEM, which the
 * application accepts as the key of an App.
 */
export function dummyApp(randomHex: (bytes: number) => string): Required<Change> {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: KEY_BITS,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const appId = APP_ID_MIN + (Number.parseInt(randomHex(4), 16) % APP_ID_SPAN);
  return {
    settings: { GITHUB_APP_ID: String(appId), GITHUB_CLIENT_ID: `Iv1.${randomHex(8)}` },
    secrets: {
      github_app_private_key: privateKey.trim(),
      github_webhook_secret: randomHex(SECRET_BYTES),
      github_client_secret: randomHex(SECRET_BYTES),
    },
  };
}
