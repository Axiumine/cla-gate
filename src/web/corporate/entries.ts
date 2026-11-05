// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
// The four entries of the corporate signing form (E21-S02) and what makes them complete.

/** What the person has typed and ticked. */
export interface Entries {
  readonly companyName: string;
  readonly signatoryTitle: string;
  readonly typedName: string;
  readonly authorityConfirmed: boolean;
}

export const EMPTY: Entries = { companyName: '', signatoryTitle: '', typedName: '', authorityConfirmed: false };

export const isBlank = (value: string): boolean => value.trim() === '';

/** Whether every text has something in it and the box is ticked: the server judges the rest. */
export function isComplete(entries: Entries): boolean {
  return (
    !isBlank(entries.companyName) &&
    !isBlank(entries.signatoryTitle) &&
    !isBlank(entries.typedName) &&
    entries.authorityConfirmed
  );
}

/** What the entries of the form are given: the values, whether a submit was tried, and how a part of them changes. */
export interface SignEntriesProps {
  readonly entries: Entries;
  readonly attempted: boolean;
  readonly onChange: (part: Partial<Entries>) => void;
}
