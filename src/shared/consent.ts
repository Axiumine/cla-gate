// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E13-S01: the consent sentence a signer agrees to. It is code, identified by an id, and a signature stores only that id
// (`signatures.consent_text_id`), so a signature can prove which wording was on screen when it was made. The server is the only
// source of the text on the sign page (the context endpoint of E13-S02 returns it); the web never carries a copy and the sign
// request (E13-S04) sends back the id alone. For that reason nothing under `src/web` imports this module, and a test keeps it so.
//
// The sentence is interface wording, not CLA text: the CLA itself is the version the signer reads, hashed and stored by E12.
// The wording needs counsel review before release (tracked as an open question, not a blocker for the story).
//
// An id never changes meaning. Editing a published sentence would change what every old signature is taken to have agreed
// to, so a test pins the SHA-256 of each text and an edit fails it. New wording is a new id (`individual-v2`), added next to the
// old one: old ids stay resolvable forever because old signatures reference them.

/** The kinds of signer a consent sentence is written for. Corporate signing (E21) adds its own kind and its own sentence. */
export type ConsentKind = 'individual';

/** One consent sentence: who it is for and the plain text shown beside the checkbox (never Markdown, never HTML). */
export interface ConsentText {
  readonly kind: ConsentKind;
  readonly text: string;
}

/**
 * Every consent sentence ever offered, by id. An id matches `^[a-z0-9-]+-v[0-9]+$` and is 1 to 64 characters long, so it
 * always fits `signatures.consent_text_id` (non-empty text). Entries are only ever added: never edit, reorder or remove one.
 */
export const CONSENT_TEXTS = Object.freeze({
  'individual-v1': Object.freeze<ConsentText>({
    kind: 'individual',
    text:
      'I have read the Contributor License Agreement version shown on this page and I agree to be bound by it. ' +
      'I understand that the full name I type and the verified email address I select are stored together with my signature.',
  }),
});

/** An id of {@link CONSENT_TEXTS}. */
export type ConsentTextId = keyof typeof CONSENT_TEXTS;

/** The id offered today for each kind of signer. A new sentence becomes current here, in the same change that adds it above. */
export const CURRENT_CONSENT_ID: Readonly<Record<ConsentKind, ConsentTextId>> = Object.freeze({
  individual: 'individual-v1',
});

/** The same entries as a `Map`, so a lookup never walks the prototype chain: `__proto__` and `constructor` are not keys. */
const BY_ID: ReadonlyMap<string, ConsentText> = new Map(Object.entries(CONSENT_TEXTS));

/**
 * The consent sentence with this id, or `undefined` for an id that was never issued. Never throws, whatever the input.
 * @param id the `consent_text_id` of a signature or of a sign request
 */
export function getConsentText(id: string): ConsentText | undefined {
  return BY_ID.get(id);
}
