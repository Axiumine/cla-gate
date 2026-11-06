// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { useT } from '../../i18n/index.ts';
import type { SelectOption } from '../../ui/index.ts';
import { formatVersion } from '../version-number.ts';
import type { VersionPair, VersionSummary } from './history-queries.ts';

// What the comparison of two versions starts from and offers (E18-S11), from the newest versions of the document.

/**
 * The pair a comparison opens on when the address names none: the version before the active one (older, the `from` side) against the
 * active one (the `to` side), so the diff reads as what the active version changed. With no active version in the list it is the newest
 * one that stands for it. `undefined` when the list holds fewer than two versions: there is nothing to compare.
 */
export function defaultPair(versions: readonly VersionSummary[]): VersionPair | undefined {
  const active = Math.max(
    0,
    versions.findIndex((version) => version.active),
  );
  const to = versions.at(active);
  const from = versions.at(active + 1);
  return to === undefined || from === undefined ? undefined : { from: from.id, to: to.id };
}

/**
 * The options of a version choice: every version of the list (its number, and "active" on the one the document points at), then the
 * ones of `chosen` that the list does not hold (the address named a version beyond the newest hundred, or one that is not this
 * document's, which the server then answers with the uniform `404`), by their id, so the choice always shows what the comparison
 * is made from.
 */
export function choiceOptions(
  versions: readonly VersionSummary[],
  chosen: readonly number[],
  t: ReturnType<typeof useT>,
): SelectOption[] {
  const listed: SelectOption[] = versions.map((version) => ({
    value: String(version.id),
    label: t(version.active ? 'history.compare.option.active' : 'history.compare.option', {
      version: formatVersion(version),
    }),
  }));
  const known = new Set(versions.map((version) => version.id));
  const missing = [...new Set(chosen)].filter((id) => !known.has(id));
  return [...listed, ...missing.map((id) => ({ value: String(id), label: t('history.compare.idOnly', { id }) }))];
}
