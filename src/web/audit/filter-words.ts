// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PlainMessageKey } from '../i18n/index.ts';
import type { FilterField } from './audit-filter-form.ts';

// The words of the text fields of the audit filter form (E18-S09): the label, the help that stays visible, and what is said when the
// text is not a value.

/** The fields that are typed; the action is a choice and has its own component. */
export type TextField = Exclude<FilterField, 'action'>;

export interface FieldWords {
  readonly label: PlainMessageKey;
  readonly help: PlainMessageKey;
  readonly invalid: PlainMessageKey;
  /** The keyboard a phone offers: digits for an id. */
  readonly inputMode: 'numeric' | 'text';
}

/**
 * The words of `field`. One `switch` over the fields with no default branch and a return type that has no `undefined`, so a field
 * added to the form fails `tsc` until it has its words.
 */
export function wordsOf(field: TextField): FieldWords {
  switch (field) {
    case 'actorGithubId':
      return {
        label: 'audit.filter.actor',
        help: 'audit.filter.actor.help',
        invalid: 'audit.filter.actor.invalid',
        inputMode: 'numeric',
      };
    case 'subjectType':
      return {
        label: 'audit.filter.subjectType',
        help: 'audit.filter.subjectType.help',
        invalid: 'audit.filter.subjectType.invalid',
        inputMode: 'text',
      };
    case 'subjectId':
      return {
        label: 'audit.filter.subjectId',
        help: 'audit.filter.subjectId.help',
        invalid: 'audit.filter.subjectId.invalid',
        inputMode: 'numeric',
      };
    case 'from':
      return {
        label: 'audit.filter.from',
        help: 'audit.filter.from.help',
        invalid: 'audit.filter.instant.invalid',
        inputMode: 'text',
      };
    case 'to':
      return {
        label: 'audit.filter.to',
        help: 'audit.filter.to.help',
        invalid: 'audit.filter.instant.invalid',
        inputMode: 'text',
      };
  }
}
