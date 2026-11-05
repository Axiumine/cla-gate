// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { type DataColumn, DataTable } from '../ui/index.ts';
import type { Entry } from './allowlist-queries.ts';
import { EntrySubject } from './EntrySubject.tsx';
import { RemoveEntry, type RemoveEntryProps } from './RemoveEntry.tsx';

/** What a table needs to offer the removal of its rows; a table without it is read-only. */
interface RemoveControl extends Pick<RemoveEntryProps, 'disabled' | 'onRemove'> {
  /** The entry whose removal is under way, if any. */
  readonly pendingId: number | undefined;
}

export interface EntriesTableProps {
  /** What the table is about: its accessible name. Text from the catalog. */
  readonly caption: string;
  readonly entries: readonly Entry[];
  /** The removal of a row; absent for a list that is read-only (the entries a repository inherits). */
  readonly remove?: RemoveControl | undefined;
}

/**
 * The entries of a scope (E18-S06): the kind, the account (the login snapshot through `UserText` and the numeric id in `<code>`), the
 * scope, who added the entry (a login, shown through `UserText`) and when, in UTC. A table that offers the removal has a last column of
 * buttons, one `AlertDialog` each; the inherited entries have none.
 */
export function EntriesTable({ caption, entries, remove }: EntriesTableProps) {
  const t = useT();
  const columns: readonly DataColumn<Entry>[] = [
    { id: 'kind', header: t('allowlist.col.kind'), render: ({ kind }) => <span>{t(`allowlist.kind.${kind}`)}</span> },
    { id: 'subject', header: t('allowlist.col.subject'), render: (entry) => <EntrySubject entry={entry} /> },
    {
      id: 'scope',
      header: t('allowlist.col.scope'),
      render: ({ scope }) => <span>{t(`allowlist.entryScope.${scope}`)}</span>,
    },
    { id: 'addedBy', header: t('allowlist.col.addedBy'), userText: ({ createdBy }) => createdBy.login },
    {
      id: 'added',
      header: t('allowlist.col.added'),
      render: ({ createdAt }) => <Timestamp value={createdAt} utc />,
    },
    ...(remove === undefined
      ? []
      : [
          {
            id: 'actions',
            header: t('allowlist.col.actions'),
            render: (entry: Entry) => (
              <RemoveEntry
                entry={entry}
                pending={remove.pendingId === entry.id}
                disabled={remove.disabled}
                onRemove={remove.onRemove}
              />
            ),
          },
        ]),
  ];
  return <DataTable caption={caption} columns={columns} rows={entries} rowKey={({ id }) => String(id)} />;
}
