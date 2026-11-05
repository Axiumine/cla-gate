// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { describe, expect, test } from 'vitest';
import { CLA_RULE_STATUS } from '../../shared/cla.ts';
import { ApiError } from '../api/index.ts';
import { createTranslator, messages } from '../i18n/index.ts';
import {
  affectedSignaturesOf,
  isContentRule,
  isRule,
  isShownByEditor,
  ruleMessage,
  SHOWN_RULES,
  shownRuleOf,
} from './document-rules.ts';

// E18-S05: how an error is told to be a rule of the documents API. A rule is the status and the code of the error body together.

const t = createTranslator(messages, 'en');
const words = { t, formatNumber: (value: number) => `#${String(value)}` };

/** The status the API answers each rule with. */
const STATUS = new Map<string, number>(Object.entries(CLA_RULE_STATUS));

/** The status of `code`, which every code of the tests has in `CLA_RULE_STATUS`. */
function statusOf(code: keyof typeof CLA_RULE_STATUS): number {
  const status = STATUS.get(code);
  if (status === undefined) {
    throw new Error(`no status for ${code}`);
  }
  return status;
}

/** The error the client throws for `code`, at the status the API answers that rule with unless the test gives another. */
const ruleError = (code: keyof typeof CLA_RULE_STATUS, details?: ApiError['details'], status?: number) =>
  new ApiError({ status: status ?? statusOf(code), code, ...(details === undefined ? {} : { details }) });

const TOO_LARGE = { limitBytes: 204_800, actualBytes: 250_001 };

describe('the rules that have words', () => {
  test.each(SHOWN_RULES.filter((rule) => rule !== 'content_too_large'))('%s is shown with its own sentence', (rule) => {
    const error = ruleError(rule);
    expect(shownRuleOf(error)).toBe(rule);
    expect(ruleMessage(words, error)).toBe(messages[`documents.rule.${rule}`]);
  });

  test('content_too_large says how large the text is and what the limit is, in the numbers of the locale', () => {
    const error = ruleError('content_too_large', TOO_LARGE);
    expect(shownRuleOf(error)).toBe('content_too_large');
    // The test words mark a number with `#`; the digits are interpolated so that no hex-looking literal stands in the source.
    expect(ruleMessage(words, error)).toBe(
      `The text is too large: #${String(TOO_LARGE.actualBytes)} bytes, and the limit is #${String(TOO_LARGE.limitBytes)}.`,
    );
  });

  test.each([
    ['no details', undefined],
    ['details of another shape', { limit: 1 }],
    ['a negative size', { limitBytes: -1, actualBytes: 5 }],
    ['sizes that are not whole numbers', { limitBytes: 1.5, actualBytes: 5 }],
  ] as const)(
    'content_too_large with %s is not shown as a rule, because its sentence needs the two numbers',
    (_label, details) => {
      const error = ruleError('content_too_large', details);
      expect(shownRuleOf(error)).toBeUndefined();
      expect(ruleMessage(words, error)).toBeUndefined();
    },
  );
});

describe('what is not a rule with words', () => {
  test.each([
    ['a rule of the API that has no sentence here', ruleError('not_found')],
    ['a rule at a status the API does not answer it with', ruleError('invalid_name', undefined, 409)],
    ['a code nobody defined', new ApiError({ status: 422, code: 'zzzz_made_up' })],
    ['an error that is not an ApiError', new Error('invalid_name')],
    ['something that is not an error', 'invalid_name'],
    ['nothing', undefined],
  ])('%s is none', (_label, error) => {
    expect(shownRuleOf(error)).toBeUndefined();
    expect(ruleMessage(words, error)).toBeUndefined();
    expect(isContentRule(error)).toBe(false);
  });
});

describe('the rules about the text', () => {
  test.each(['content_too_large', 'content_empty', 'content_invalid_characters', 'content_too_deeply_nested'] as const)(
    '%s is shown by the editor under the text',
    (rule) => {
      const error = ruleError(rule, rule === 'content_too_large' ? TOO_LARGE : undefined);
      expect(isContentRule(error)).toBe(true);
      expect(isShownByEditor(error)).toBe(true);
    },
  );

  test.each(['invalid_name', 'invalid_rationale', 'content_unchanged', 'version_conflict'] as const)(
    '%s is a rule with words and is not about the text',
    (rule) => {
      expect(isContentRule(ruleError(rule))).toBe(false);
      expect(isShownByEditor(ruleError(rule))).toBe(false);
    },
  );

  test('a draft conflict is shown by the editor, as its banner, and a forbidden answer is left to the general error state', () => {
    expect(isShownByEditor(ruleError('draft_conflict'))).toBe(true);
    expect(isShownByEditor(ruleError('forbidden'))).toBe(false);
  });
});

describe('isRule', () => {
  test('is true for the code at the status of the rule, and false for the same code at another status or another code', () => {
    expect(isRule(ruleError('draft_conflict'), 'draft_conflict')).toBe(true);
    expect(isRule(ruleError('draft_conflict', undefined, 500), 'draft_conflict')).toBe(false);
    expect(isRule(ruleError('stale_active_version'), 'draft_conflict')).toBe(false);
    expect(isRule(new Error('draft_conflict'), 'draft_conflict')).toBe(false);
  });
});

describe('the signatures a publish would make outdated', () => {
  test('are the number in the details of resign_confirmation_required', () => {
    expect(affectedSignaturesOf(ruleError('resign_confirmation_required', { affectedSignatures: 7 }))).toBe(7);
    expect(affectedSignaturesOf(ruleError('resign_confirmation_required', { affectedSignatures: 0 }))).toBe(0);
  });

  test.each([
    ['details that do not hold it', ruleError('resign_confirmation_required', { other: 1 })],
    ['no details', ruleError('resign_confirmation_required')],
    ['a count that is not a whole number', ruleError('resign_confirmation_required', { affectedSignatures: 1.5 })],
    ['a negative count', ruleError('resign_confirmation_required', { affectedSignatures: -1 })],
    ['another rule with the same details', ruleError('stale_active_version', { affectedSignatures: 7 })],
    ['an error that is not an ApiError', new Error('x')],
  ])('are not there for %s', (_label, error) => {
    expect(affectedSignaturesOf(error)).toBeUndefined();
  });
});
