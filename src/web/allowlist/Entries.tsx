// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useRef, useState } from 'react';
import type { InstallationSummary } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Heading, StatusMessage, type StatusTone } from '../ui/index.ts';
import { AddEntryDialog } from './AddEntryDialog.tsx';
import type { AllowlistView, Entry } from './allowlist-queries.ts';
import type { MoreEntries } from './EntryRows.tsx';
import { EntryRows } from './EntryRows.tsx';
import { InheritedEntries } from './InheritedEntries.tsx';
import type { OrgMembersAvailability } from './KindField.tsx';
import { type RemovalOutcome, useRemoveEntry } from './use-remove-entry.ts';

/** What the screen last did, said in the live region: an entry added, removed, or one that was not there to remove. */
type Notice = RemovalOutcome | 'added';

/** The look of a notice: an entry that was not there is information, the rest is a success, and no notice is plain. */
function toneOf(notice: Notice | undefined): StatusTone {
  switch (notice) {
    case undefined:
      return 'neutral';
    case 'gone':
      return 'info';
    case 'added':
    case 'removed':
      return 'success';
  }
}

/**
 * Whether the members of the organisation can be added in this scope: not for the installation of a user account, which has no
 * organisation, and once only per scope (the server refuses a second one with `allowlist_entry_exists`).
 */
function orgMembersIn(installation: InstallationSummary | undefined, own: readonly Entry[]): OrgMembersAvailability {
  if (installation?.accountType === 'User') {
    return 'userAccount';
  }
  return own.some((entry) => entry.kind === 'org_members') ? 'exists' : 'available';
}

export interface EntriesProps {
  readonly installationId: number;
  /** The repository whose allowlist this is, or `undefined` for the whole installation. */
  readonly repositoryId: number | undefined;
  readonly installation: InstallationSummary | undefined;
  readonly view: AllowlistView;
  readonly more: MoreEntries;
}

/**
 * The entries of one scope once the server has answered for it (E18-S06): the heading, "Add entry", what the last action did (a polite live
 * region), the list with a removal on each row, "Show more entries" when the server has more, and for a repository the entries it inherits,
 * read-only. Nothing is optimistic: an add or a removal changes the rows when the list has been asked for again. A removal that fails for
 * another reason leaves the list as it is and says why above it; once a row is removed focus moves to the heading, because the row
 * that had it is gone. Everything is off while the installation is suspended.
 */
export function Entries({ installationId, repositoryId, installation, view, more }: EntriesProps) {
  const t = useT();
  const [notice, setNotice] = useState<Notice | undefined>(undefined);
  const heading = useRef<HTMLHeadingElement>(null);
  const suspended = installation?.suspended === true;
  const removal = useRemoveEntry({
    installationId,
    onOutcome: (outcome) => {
      setNotice(outcome);
      if (outcome === 'removed') {
        heading.current?.focus();
      }
    },
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Heading level={2} ref={heading} focusable>
          {t('allowlist.entries.title')}
        </Heading>
        <AddEntryDialog
          installationId={installationId}
          repositoryId={repositoryId}
          orgMembers={orgMembersIn(installation, view.own)}
          suspended={suspended}
          onAdded={() => {
            setNotice('added');
          }}
        />
      </div>
      <StatusMessage tone={toneOf(notice)}>
        {notice === undefined ? null : t(`allowlist.notice.${notice}`)}
      </StatusMessage>
      <EntryRows entries={view.own} removal={{ ...removal, disabled: suspended }} more={more} />
      <InheritedEntries entries={view.inherited} />
    </div>
  );
}
