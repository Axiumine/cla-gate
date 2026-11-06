// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { Button } from '../ui/index.ts';
import type { Entry } from './allowlist-queries.ts';
import { EmptyAllowlist } from './EmptyAllowlist.tsx';
import { EntriesTable } from './EntriesTable.tsx';

/** What the pager under the entries needs: whether there is a next page, whether it is loading, and how to ask for it. */
export interface MoreEntries {
  readonly available: boolean;
  readonly loading: boolean;
  readonly load: () => void;
}

/** The removal of an entry as the rows use it: the one in flight, why the last one failed, whether it is off, and how to ask for one. */
interface EntryRemoval {
  readonly pendingId: number | undefined;
  readonly failure: unknown;
  readonly disabled: boolean;
  readonly remove: (entry: Entry) => void;
}

export interface EntryRowsProps {
  readonly entries: readonly Entry[];
  readonly removal: EntryRemoval;
  readonly more: MoreEntries;
}

/**
 * The entries of the scope itself (E18-S06): why the last removal failed, if it did and the list stands as it was, then the table with a
 * removal on each row or the empty state that explains the allowlist, and "Show more entries" when the server has another page.
 */
export function EntryRows({ entries, removal, more }: EntryRowsProps) {
  const t = useT();
  return (
    <>
      {removal.failure === undefined ? null : <ErrorState variant="banner" error={removal.failure} />}
      {entries.length === 0 ? (
        <EmptyAllowlist />
      ) : (
        <EntriesTable
          caption={t('allowlist.caption')}
          entries={entries}
          remove={{ pendingId: removal.pendingId, disabled: removal.disabled, onRemove: removal.remove }}
        />
      )}
      {more.available ? (
        <div>
          <Button loading={more.loading} onClick={more.load}>
            {t('allowlist.more')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
