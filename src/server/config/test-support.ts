// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import { type GitHubPrivateKey, publicKeyFingerprint } from './github-key.ts';
import { Secret } from './secret.ts';

// Key material for tests is made when the test runs and never written down: no key is committed (E05-S01), so the
// secret scanner has nothing to find and no test depends on a key that leaked.

/** A throw-away RSA key pair in the encodings GitHub hands out and the environment can hold. */
export interface TestRsaKey {
  /** PKCS#1, the `RSA PRIVATE KEY` PEM that GitHub's "Generate a private key" button downloads. */
  readonly pkcs1: string;
  /** PKCS#8, the plain `PRIVATE KEY` PEM. */
  readonly pkcs8: string;
  /** The public half, for `crypto.verify` in the signer tests. */
  readonly publicKey: KeyObject;
}

/** A fresh RSA key pair. 2048 bits takes a fraction of a second, so share one per test file where you can. */
export function testRsaKey(modulusLength = 2048): TestRsaKey {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength });
  return {
    pkcs1: privateKey.export({ type: 'pkcs1', format: 'pem' }),
    pkcs8: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKey,
  };
}

/** An environment-file spelling of `pem`: one line, newlines written as a backslash and `n`. */
export function escapeNewlines(pem: string): string {
  return pem.trim().replaceAll('\n', String.raw`\n`);
}

/** The private keys GitHub does not accept for an App, as PEM text, by what is wrong with them. */
export function testUnsuitableKeys(): Readonly<Record<string, string>> {
  const rsa = testRsaKey();
  const pss = generateKeyPairSync('rsa-pss', { modulusLength: 2048 });
  return {
    'an EC key': generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'an Ed25519 key': generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'an RSA-PSS key': pss.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'an encrypted key': generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'made-up-passphrase',
    }),
    'a public key': rsa.publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

/** A throw-away signing key as the configuration holds it, with the public half for `crypto.verify` (E05-S02). */
export interface TestGitHubKey {
  readonly key: GitHubPrivateKey;
  /** The PKCS#8 PEM, to look for in logs and errors. */
  readonly pem: string;
  readonly publicKey: KeyObject;
}

/** A fresh key in the shape of {@link GitHubPrivateKey}: what `parseGitHubPrivateKey` would return for it. */
export function testGitHubKey(): TestGitHubKey {
  const { pkcs8, publicKey } = testRsaKey();
  return { key: { pem: new Secret(pkcs8), fingerprint: publicKeyFingerprint(publicKey) }, pem: pkcs8, publicKey };
}
