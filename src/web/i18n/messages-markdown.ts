// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the CLA text view (E18): what the page says while a long text is being formatted, and when it shows the text as it
 * was written because formatting took too long. A catalog of its own so that the main catalog stays under the size cap, and the main
 * catalog spreads it in; the rules of `messages.ts` hold for every key here.
 */
export const markdownMessages = {
  'markdown.pending': 'Preparing the text…',
  'markdown.plain':
    'This text is long or complicated, so it is shown as it was written, without formatting. Nothing in it is missing.',
} as const;
