// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  CONSENT_TEXTS,
  CURRENT_CONSENT_ID,
  currentCorporateConsent,
  currentIndividualConsent,
  getConsentText,
} from './consent.ts';

// E13-S01: the registry of consent sentences. What a signature proves is the id it stores, so these tests pin what each id
// means: a published sentence is never edited, and a new sentence is a new id.

/** The key shape of a consent text id, and the longest id the registry accepts. */
const ID_SHAPE = /^[a-z0-9-]+-v\d+$/u;
const ID_MAX_LENGTH = 64;

const entries = Object.entries(CONSENT_TEXTS);

/** The lower case hex SHA-256 of the UTF-8 bytes of `text` (Web Crypto: this folder is also compiled for the browser). */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

test('the first entry is individual-v1 and it is the id offered to an individual today', () => {
  expect(entries[0]?.[0]).toBe('individual-v1');
  expect(CURRENT_CONSENT_ID.individual).toBe('individual-v1');
  expect(getConsentText(CURRENT_CONSENT_ID.individual)?.kind).toBe('individual');
});

test('the registry and the table of current ids are frozen, entries included', () => {
  expect(Object.isFrozen(CONSENT_TEXTS)).toBe(true);
  expect(Object.isFrozen(CURRENT_CONSENT_ID)).toBe(true);
  expect(entries.every(([, entry]) => Object.isFrozen(entry))).toBe(true);
});

// Published wording never changes meaning. If this test fails you edited a sentence that signatures already reference: keep
// the old entry as it was and add the new wording under a new id (individual-v2), then make that id current.
test('the SHA-256 of every published text is pinned', async () => {
  const hashes = Object.fromEntries(
    await Promise.all(entries.map(async ([id, entry]): Promise<[string, string]> => [id, await sha256(entry.text)])),
  );
  expect(hashes).toMatchInlineSnapshot(`
    {
      "corporate-v1": "1e957da12afe49a3e7de8b43dce76cd87eb09997d05df15efad283bdbd17843c",
      "individual-v1": "eac89b388fbd5338267383e49008177870b0d99faa790f5c2a2e14c962454f48",
    }
  `);
});

test('every id keeps the kind it was published with', () => {
  expect(Object.fromEntries(entries.map(([id, entry]) => [id, entry.kind]))).toEqual({
    'individual-v1': 'individual',
    'corporate-v1': 'corporate',
  });
});

test('there is at least one entry and every id matches the pattern and fits 1 to 64 characters', () => {
  expect(entries.length).toBeGreaterThan(0);
  for (const [id] of entries) {
    expect(id, id).toMatch(ID_SHAPE);
    expect(id.length, id).toBeGreaterThanOrEqual(1);
    expect(id.length, id).toBeLessThanOrEqual(ID_MAX_LENGTH);
  }
});

test.each([
  ['an empty id', '', false],
  ['a capital letter', 'Individual-v1', false],
  ['no version', 'individual', false],
  ['a version without digits', 'individual-vx', false],
  ['an underscore', 'individual_v1', false],
  ['a space', 'individual v1', false],
  ['a trailing newline', 'individual-v1\n', false],
  ['the first id', 'individual-v1', true],
  ['a later version', 'individual-v12', true],
  ['digits in the name', 'corporate2-v3', true],
])('the id pattern, %s: %j', (_what, id, matches) => {
  expect(ID_SHAPE.test(id)).toBe(matches);
});

test('every value of CURRENT_CONSENT_ID is an id of CONSENT_TEXTS, for the kind it is offered to', () => {
  for (const [kind, id] of Object.entries(CURRENT_CONSENT_ID)) {
    expect(Object.keys(CONSENT_TEXTS), kind).toContain(id);
    expect(getConsentText(id)?.kind, kind).toBe(kind);
  }
  expect(Object.keys(CURRENT_CONSENT_ID)).toEqual(['individual', 'corporate']);
});

test.each(['individual-v1', 'corporate-v1'])('%s is plain text of at most 600 characters', (id) => {
  const text = getConsentText(id)?.text ?? '';
  expect(text.length).toBeGreaterThan(0);
  expect(text.length).toBeLessThanOrEqual(600);
  // Plain text: no control character (a line break included), no markup or Markdown syntax, nothing to trim or collapse.
  expect(text).not.toMatch(/[\p{Cc}\u2028\u2029<>&`*_#[\]\\|]/u);
  expect(text).toBe(text.normalize('NFC').trim().replaceAll(/\s+/gu, ' '));
});

test.each([
  ['the CLA version shown was read', /\bhave read the Contributor License Agreement version shown\b/u],
  ['the signer agrees to be bound', /\bagree to be bound by it\b/u],
  ['the typed name is stored', /\bfull name I type\b.*\bstored\b/u],
  ['the selected verified email is stored', /\bverified email address I select\b.*\bstored\b/u],
  ['both are stored with the signature', /\bstored together with my signature\b/u],
])('individual-v1 states that %s', (_what, statement) => {
  expect(getConsentText('individual-v1')?.text).toMatch(statement);
});

test('getConsentText returns the registry entry itself for a known id', () => {
  expect(getConsentText('individual-v1')).toBe(CONSENT_TEXTS['individual-v1']);
});

test.each([
  ['an id never issued', 'individual-v2'],
  ['the empty string', ''],
  ['another case', 'INDIVIDUAL-V1'],
  ['a padded id', ' individual-v1'],
  ['__proto__', '__proto__'],
  ['constructor', 'constructor'],
  ['toString', 'toString'],
  ['hasOwnProperty', 'hasOwnProperty'],
  ['prototype', 'prototype'],
])('getConsentText returns undefined for %s without throwing', (_what, id) => {
  expect(getConsentText(id)).toBeUndefined();
});

test('the consent offered to an individual is the id of CURRENT_CONSENT_ID with the sentence of that very entry (E13-S02)', () => {
  expect(currentIndividualConsent()).toEqual({
    id: 'individual-v1',
    text: CONSENT_TEXTS['individual-v1'].text,
  });
  expect(currentIndividualConsent().id).toBe(CURRENT_CONSENT_ID.individual);
  expect(getConsentText(currentIndividualConsent().id)?.text).toBe(currentIndividualConsent().text);
});

test('the consent offered to the signatory of a corporate CLA is the id of CURRENT_CONSENT_ID with the sentence of that very entry (E21-S02)', () => {
  expect(currentCorporateConsent()).toEqual({ id: 'corporate-v1', text: CONSENT_TEXTS['corporate-v1'].text });
  expect(currentCorporateConsent().id).toBe(CURRENT_CONSENT_ID.corporate);
});

test.each([
  ['the signatory is authorised to sign for the company', /\bauthorised to sign for the company\b/u],
  ['the corporate CLA version shown was read', /\bread the Corporate Contributor License Agreement version shown\b/u],
  ['the company is bound', /\bOn behalf of the company I agree to be bound by it\b/u],
  ['the company name, the title, the name and the address are stored', /\bcompany name, my title\b.*\bstored\b/u],
])('corporate-v1 states that %s', (_what, statement) => {
  expect(getConsentText('corporate-v1')?.text).toMatch(statement);
});
