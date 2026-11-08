// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import { expect, test } from 'vitest';
import { createLogger } from '../adapters/http/logger.ts';
import { captureLogs } from '../test-support.ts';
import { type GitHubPrivateKey, parseGitHubPrivateKey, publicKeyFingerprint } from './github-key.ts';
import { mask } from './secret.ts';
import { escapeNewlines, testRsaKey, testUnsuitableKeys } from './test-support.ts';

const KEY = testRsaKey();

/**
 * The fixed 24 bytes that make the PKCS#1 public key of a 2048-bit RSA key a SubjectPublicKeyInfo (what `openssl rsa
 * -pubout -outform DER` prints, and so what GitHub hashes): a SEQUENCE holding the rsaEncryption algorithm identifier
 * and a BIT STRING of 0x10f bytes. It is a constant of the format and holds no key material.
 */
const SPKI_HEADER_2048 = Buffer.from('30820122300d06092a864886f70d01010105000382010f00', 'hex');

function pinoLine(value: object): string {
  const logs = captureLogs();
  createLogger({ logLevel: 'info' }, logs.destination).info({ key: value }, 'with a key');
  return logs.text();
}

test('the fingerprint is the SHA-256 of the DER public key (SPKI, not PKCS#1), standard base64, as the openssl recipe prints it', () => {
  const pkcs1 = KEY.publicKey.export({ type: 'pkcs1', format: 'der' });
  const expected = createHash('sha256')
    .update(Buffer.concat([SPKI_HEADER_2048, pkcs1]))
    .digest('base64');
  expect(publicKeyFingerprint(KEY.publicKey)).toBe(`SHA256:${expected}`);
  const wrong = createHash('sha256').update(pkcs1).digest('base64');
  expect(publicKeyFingerprint(KEY.publicKey)).not.toBe(`SHA256:${wrong}`);
});

test.each([
  ['PKCS#1', KEY.pkcs1, KEY.pkcs1.trim()],
  ['PKCS#8', KEY.pkcs8, KEY.pkcs8.trim()],
  ['PKCS#1 with escaped newlines', escapeNewlines(KEY.pkcs1), KEY.pkcs1.trim()],
  ['PKCS#8 with escaped newlines', escapeNewlines(KEY.pkcs8), KEY.pkcs8.trim()],
  ['PKCS#8 with surrounding whitespace', `\n  ${KEY.pkcs8}  \n`, KEY.pkcs8.trim()],
])('a %s key is accepted, kept with real newlines and fingerprinted as GitHub displays it', (_label, text, pem) => {
  const parsed = parseGitHubPrivateKey(text);
  expect(parsed?.pem.reveal()).toBe(pem);
  expect(parsed?.fingerprint).toBe(publicKeyFingerprint(KEY.publicKey));
  expect(parsed?.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}=$/);
});

test('two different keys have different fingerprints', () => {
  const other = parseGitHubPrivateKey(testRsaKey().pkcs8);
  expect(other?.fingerprint).toMatch(/^SHA256:/);
  expect(other?.fingerprint).not.toBe(parseGitHubPrivateKey(KEY.pkcs8)?.fingerprint);
});

test.each([
  ['a key of 1024 bits', testRsaKey(1024).pkcs8],
  ['a key of 2047 bits', testRsaKey(2047).pkcs1],
  ['a truncated PEM', KEY.pkcs8.slice(0, KEY.pkcs8.length / 2)],
  ['a PEM with its footer cut off', KEY.pkcs1.replace(/-----END RSA PRIVATE KEY-----\n?$/, '')],
  ['text that is not a key', 'definitely not a key'],
  ['the escape sequence alone', String.raw`\n\n`],
  ...Object.entries(testUnsuitableKeys()),
])('%s is refused', (_label, text) => {
  expect(parseGitHubPrivateKey(text)).toBeUndefined();
});

test.each([
  ['String() of the PEM', (key: GitHubPrivateKey) => String(key.pem)],
  ['JSON.stringify', (key: GitHubPrivateKey) => JSON.stringify(key)],
  ['util.inspect', (key: GitHubPrivateKey) => inspect({ nested: { key } }, { depth: 6 })],
  ['pino', (key: GitHubPrivateKey) => pinoLine(key)],
])('a parsed key printed with %s shows the mask, never the key', (_label, print) => {
  const parsed = parseGitHubPrivateKey(KEY.pkcs8);
  const printed = parsed === undefined ? '' : print(parsed);
  expect(printed).toContain(mask());
  expect(printed).not.toContain('PRIVATE KEY');
  expect(printed).not.toContain(KEY.pkcs8.split('\n')[1] ?? 'missing');
});

test('the fingerprint, which is not secret, can be logged', () => {
  const parsed = parseGitHubPrivateKey(KEY.pkcs8);
  expect(pinoLine({ fingerprint: parsed?.fingerprint })).toContain(publicKeyFingerprint(KEY.publicKey));
});
