// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { Secret } from './secret.ts';

/** GitHub refuses smaller keys for an App, and so do we (E05-S01). */
const MIN_MODULUS_BITS = 2048;

const RsaDetails = z.object({ modulusLength: z.number().min(MIN_MODULUS_BITS) });

/** A GitHub App signing key as the configuration holds it: validated once, and unprintable. */
export interface GitHubPrivateKey {
  /**
   * The PEM, PKCS#1 or PKCS#8, with real newlines whichever way it came in. A {@link Secret}: only the JWT signer
   * (E05-S02) calls `reveal()`.
   */
  readonly pem: Secret;
  /** What GitHub shows on the App settings page, `SHA256:<base64>`. The only thing about a key that may be logged. */
  readonly fingerprint: string;
}

/**
 * `SHA256:` plus the base64 of the SHA-256 of the DER-encoded (SubjectPublicKeyInfo) public key: GitHub's display
 * format, `openssl rsa -pubout -outform DER | openssl sha256 -binary | openssl base64`.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function publicKeyFingerprint(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `SHA256:${createHash('sha256').update(der).digest('base64')}`;
}

/** @returns the key, or undefined for text that is not a private key. The parser's message is dropped: it may quote input. */
function readPrivateKey(pem: string): KeyObject | undefined {
  try {
    return createPrivateKey(pem);
  } catch {
    return undefined;
  }
}

/**
 * Parses an App private key once, with `crypto.createPrivateKey`. Environment files and `--env-file` cannot hold
 * newlines, so a literal backslash followed by `n` stands for one.
 * @returns the key, or undefined unless the text is an RSA private key of at least 2048 bits (a truncated PEM, a public
 * key, an encrypted key, an EC or RSA-PSS key and a short key all give undefined). The text is never part of a result.
 */
export function parseGitHubPrivateKey(text: string): GitHubPrivateKey | undefined {
  const pem = text.replaceAll(String.raw`\n`, '\n').trim();
  const key = readPrivateKey(pem);
  if (key?.asymmetricKeyType !== 'rsa' || !RsaDetails.safeParse(key.asymmetricKeyDetails).success) {
    return undefined;
  }
  return { pem: new Secret(pem), fingerprint: publicKeyFingerprint(createPublicKey(key)) };
}
