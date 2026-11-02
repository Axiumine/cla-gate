// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, githubIdSchema } from '../../shared/github-id.ts';

/** The most account ids `GITHUB_ALLOWED_ACCOUNT_IDS` may name, once duplicates are collapsed (E05-S07). */
const MAX_ACCOUNT_IDS = 100;

/** Digits only and no leading zero: `0`, `007`, `-5`, `1.5`, `+3`, `1e3` and a login are all refused. */
const POSITIVE_INTEGER = /^[1-9]\d*$/;

/**
 * Reads `GITHUB_ALLOWED_ACCOUNT_IDS`: comma-separated numeric GitHub account ids, whitespace around each trimmed,
 * duplicates collapsed (the first spelling keeps its place), at most {@link MAX_ACCOUNT_IDS} distinct ids. The identity
 * of an account is its number and never its login, so a login is refused like any other text that is not a positive
 * safe integer (a number above `Number.MAX_SAFE_INTEGER` included). Blank text is an empty list: the instance then
 * serves the App owner's account only. An empty element (`1,,2`, a trailing comma) is a mistake, not an empty list.
 * @returns the ids, or undefined for text that is not such a list.
 */
export function parseAllowedAccountIds(value: string): readonly GithubId[] | undefined {
  if (value.trim() === '') {
    return [];
  }
  const ids = new Set<GithubId>();
  for (const part of value.split(',')) {
    const text = part.trim();
    const parsed = POSITIVE_INTEGER.test(text) ? githubIdSchema.safeParse(Number(text)) : undefined;
    if (parsed?.success !== true) {
      return undefined;
    }
    ids.add(parsed.data);
  }
  return ids.size > MAX_ACCOUNT_IDS ? undefined : [...ids];
}
