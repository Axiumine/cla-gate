// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The English message catalog (E17-S02): every string the user can read, under a dotted key. A flat `as const` object, so
 * the type of each message is its literal text and the `{name}` placeholders in it can be read by the compiler. A message
 * holds placeholders written `{name}` (a lower-case letter, then letters and digits) and no other brace. A plural is two
 * keys, `<base>.one` and `<base>.other`, that use the same placeholders; `t.plural(<base>, count)` picks between them.
 *
 * A second language is a second object of the same keys. Each story that shows text adds its keys here, and no component
 * writes text inline (the lint rule in scripts/web/eslint-config.ts enforces it).
 */
export const messages = {
  'app.name': 'CLA Platform',
  'common.close': 'Close',
  'common.required': '(required)',
  'common.unknownDate': 'Unknown date',
  'errors.forbidden': 'You do not have access to this page.',
  'status.active': 'Active',
  'status.cancelled': 'Cancelled',
  'status.disabled': 'Disabled',
  'status.draft': 'Draft',
  'status.enabled': 'Enabled',
  'status.failed': 'Failed',
  'status.outdated': 'Outdated',
  'status.passed': 'Passed',
  'status.pending': 'Pending',
  'status.revoked': 'Revoked',
  'status.suspended': 'Suspended',
} as const;

/** The type of the catalog itself, whose literal messages the placeholder types are read from. */
export type Messages = typeof messages;

/** A key of the catalog: `t('typo')` fails `tsc`. */
export type MessageKey = keyof Messages;
