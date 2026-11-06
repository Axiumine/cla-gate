// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the erasure of a signer's personal data (E18-S14): the button on a signature, the question with what is removed and what
 * stays, the numbers the server counted and the words of the failures the server answers with a rule of its own. They are a catalog of
 * their own so that the other catalogs stay under the size cap, and the main catalog spreads them in; the rules of `messages.ts` hold for
 * every key here (a dotted key, a `{name}` placeholder, a `.one` with its `.other`).
 */
export const eraseMessages = {
  'erase.action': 'Erase personal data',
  'erase.action.label': 'Erase personal data of {signer}',
  'erase.confirm': 'Erase personal data',
  'erase.countChanged':
    'The data held for this person changed while this question was open. Check the new numbers and confirm again.',
  'erase.description':
    'Erasing removes the personal data this installation holds for the person. It cannot be undone, and it does not touch any signature.',
  'erase.done.one': 'Personal data erased: {count} record removed. The signatures stay as legal evidence.',
  'erase.done.other': 'Personal data erased: {count} records removed. The signatures stay as legal evidence.',
  'erase.erased.label': 'The personal data of {signer} is erased',
  'erase.nothing':
    'This installation holds no signature and no personal data of this person, so there is nothing to erase.',
  'erase.removes': 'What is removed',
  'erase.removes.allowlist.one': 'The login shown on {count} allowlist entry. The entry stays, kept by GitHub id.',
  'erase.removes.allowlist.other': 'The login shown on {count} allowlist entries. The entries stay, kept by GitHub id.',
  'erase.removes.pii.one': 'The name, email address and GitHub login the person gave when signing ({count} record).',
  'erase.removes.pii.other': 'The name, email address and GitHub login the person gave when signing ({count} records).',
  'erase.removes.sessions':
    'Their sign-in sessions, unless another installation on this server also holds data about them.',
  'erase.stays': 'What stays',
  'erase.stays.again': 'The person can sign again. A new signature stores new personal data.',
  'erase.stays.signatures.one': '{count} signature stays, still valid, as the legal evidence of what was agreed.',
  'erase.stays.signatures.other': '{count} signatures stay, still valid, as the legal evidence of what was agreed.',
  'erase.title': 'Erase the personal data of',
} as const;
