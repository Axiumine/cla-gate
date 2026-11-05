// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { CLA_RULE_STATUS, type ClaRule } from '../../shared/cla.ts';
import { ApiError } from '../api/index.ts';
import type { Messages } from '../i18n/messages.ts';
import type { Translate } from '../i18n/translate.ts';

// The rules of the documents API (E12) that the screens of E18-S05 show in words of their own, and how an error is told to be one
// (E18-S05). A rule is told by the status and the code of the error body together, never by anything the server wrote as text.

/**
 * The rules a document screen writes a message for, each with the catalog key `documents.rule.<rule>`. A rule that is not here
 * (`not_found`, `forbidden`, a conflict nobody expected) goes through the general error state, and so does any code the server
 * adds later.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const SHOWN_RULES = [
  'invalid_name',
  'kind_not_supported',
  'document_limit_reached',
  'document_name_taken',
  'content_too_large',
  'content_empty',
  'content_invalid_characters',
  'content_too_deeply_nested',
  'invalid_rationale',
  'first_version_must_be_major',
  'content_unchanged',
  'version_conflict',
] as const satisfies readonly ClaRule[];

export type ShownRule = (typeof SHOWN_RULES)[number];

/** The rules of the text of a CLA, which the editor shows under the text. */
const CONTENT_RULES: readonly ShownRule[] = [
  'content_too_large',
  'content_empty',
  'content_invalid_characters',
  'content_too_deeply_nested',
];

/** The two numbers of `422 content_too_large`: the limit and the size the text has, in bytes. */
const tooLargeDetails = z.object({ limitBytes: z.int().min(0), actualBytes: z.int().min(0) });

/** The status each rule of the API is answered with, by code. */
const RULE_STATUS: ReadonlyMap<string, number> = new Map(Object.entries(CLA_RULE_STATUS));

/** The code of `error` when it is the answer of the documents API to a rule: its code and its status are the ones of `CLA_RULE_STATUS`. */
function ruleCodeOf(error: unknown): string | undefined {
  return error instanceof ApiError && RULE_STATUS.get(error.code) === error.status ? error.code : undefined;
}

/** The rule `error` is, when it is one of {@link SHOWN_RULES}. A `content_too_large` without its two numbers is not shown as a rule (the message needs them). */
export function shownRuleOf(error: unknown): ShownRule | undefined {
  const rule = ruleCodeOf(error);
  const shown = SHOWN_RULES.find((candidate) => candidate === rule);
  if (shown === 'content_too_large' && !tooLargeDetails.safeParse(detailsOf(error)).success) {
    return undefined;
  }
  return shown;
}

/** Whether `error` is a rule about the text of the CLA, which the editor shows under the text. */
export function isContentRule(error: unknown): boolean {
  const rule = shownRuleOf(error);
  return rule !== undefined && CONTENT_RULES.includes(rule);
}

/** Whether `error` is the answer `rule` of the documents API (`409 draft_conflict`, `409 stale_active_version`, ...). */
export function isRule(error: unknown, rule: ClaRule): boolean {
  return ruleCodeOf(error) === rule;
}

function detailsOf(error: unknown): unknown {
  return error instanceof ApiError ? error.details : undefined;
}

/** `formatNumber` is the locale's way of writing a count; `t` is the translator of the app. */
export interface RuleWords {
  readonly t: Translate<Messages>;
  readonly formatNumber: (value: number) => string;
}

/** The words for `error` when it is one of {@link SHOWN_RULES}, from the catalog; `undefined` for any other error. */
export function ruleMessage({ t, formatNumber }: RuleWords, error: unknown): string | undefined {
  const rule = shownRuleOf(error);
  if (rule === undefined) {
    return undefined;
  }
  if (rule === 'content_too_large') {
    const sizes = tooLargeDetails.parse(detailsOf(error));
    return t('documents.rule.content_too_large', {
      actual: formatNumber(sizes.actualBytes),
      limit: formatNumber(sizes.limitBytes),
    });
  }
  return t(`documents.rule.${rule}`);
}

/** The count of signatures that a publish would make stale, from the details of `409 resign_confirmation_required`; `undefined` when they are not there. */
export function affectedSignaturesOf(error: unknown): number | undefined {
  const parsed = z.object({ affectedSignatures: z.int().min(0) }).safeParse(detailsOf(error));
  return isRule(error, 'resign_confirmation_required') && parsed.success ? parsed.data.affectedSignatures : undefined;
}

/** Whether the editor shows `error` itself (under the text, or as the conflict banner), so the general error state must not. */
export function isShownByEditor(error: unknown): boolean {
  return isContentRule(error) || isRule(error, 'draft_conflict');
}
