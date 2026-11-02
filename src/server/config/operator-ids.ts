// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import { parseGithubIdList } from './allowed-accounts.ts';

/** The most operator ids `OPERATOR_GITHUB_IDS` may name, once duplicates are collapsed (E11-S08). */
const MAX_OPERATOR_IDS = 20;

/**
 * Reads `OPERATOR_GITHUB_IDS` (E11-S08): comma-separated numeric GitHub user ids, whitespace around each trimmed, duplicates
 * collapsed (the first spelling keeps its place), at most {@link MAX_OPERATOR_IDS} distinct ids. A login, `0`, a negative
 * number, a decimal and an empty element (`1,,2`) are refused like in the list of allowed accounts. Blank text names no
 * operator: the caller treats it as the variable unset (an empty variable already is).
 * @returns the ids (none for blank text), or undefined for text that is not such a list.
 */
export function parseOperatorGithubIds(value: string): readonly GithubId[] | undefined {
  return value.trim() === '' ? [] : parseGithubIdList(value, MAX_OPERATOR_IDS);
}
