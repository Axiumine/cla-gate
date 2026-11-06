// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the invalidation of the signatures of a major version (E18-S14): the button on the history, the question with the numbers
 * the server counted, the acknowledgement of that count and the words of the failures the server answers with a rule of its own. They are a
 * catalog of their own so that the other catalogs stay under the size cap, and the main catalog spreads them in; the rules of
 * `messages.ts` hold for every key here (a dotted key, a `{name}` placeholder, a `.one` with its `.other`).
 */
export const invalidateMessages = {
  'invalidate.acknowledge.one':
    'I have seen that {count} signature of version {major} will stop covering pull requests.',
  'invalidate.acknowledge.other':
    'I have seen that {count} signatures of version {major} will stop covering pull requests.',
  'invalidate.acknowledge.required': 'Confirm that you have seen the number of signatures.',
  'invalidate.action': 'Invalidate signatures',
  'invalidate.action.label': 'Invalidate signatures of version {major}',
  'invalidate.confirm': 'Invalidate signatures',
  'invalidate.countChanged':
    'The number of signatures changed while this question was open. Check the new number and confirm again.',
  'invalidate.description':
    'Every signature of this version is taken out of force, for pull requests checked from now on. Contributions already accepted stay licensed, and the people affected sign again to be covered. This cannot be undone.',
  'invalidate.done.one':
    '{count} signature of version {major} was invalidated. Pull requests of the repositories that use this document are checked again.',
  'invalidate.done.other':
    '{count} signatures of version {major} were invalidated. Pull requests of the repositories that use this document are checked again.',
  'invalidate.gone':
    'Every signature of version {major} was taken out of force in the meantime, so there is nothing left to invalidate.',
  'invalidate.nothing': 'No signature of version {major} is in force, so there is nothing to invalidate.',
  'invalidate.preview.activeSignatures': 'Signatures in force',
  'invalidate.preview.affectedRepositories': 'Repositories checked again',
  'invalidate.preview.label': 'What invalidating version {major} does',
  'invalidate.title': 'Invalidate the signatures of version {major} of',
} as const;
