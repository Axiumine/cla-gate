// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { type DataColumn, DataTable, UserText } from '../ui/index.ts';
import type { CommitOverride } from './pending-queries.ts';
import { RemoveOverride, type RemoveOverrideProps } from './RemoveOverride.tsx';

/** What a table needs to offer the removal of its rows. */
type RemoveControl = Pick<
  RemoveOverrideProps,
  'installationId' | 'repositoryId' | 'suspended' | 'onOutcome' | 'onVanished'
>;

export interface OverridesTableProps {
  readonly items: readonly CommitOverride[];
  /** The removal of the rows. There is no editing: an override is removed and recorded anew. */
  readonly remove: RemoveControl;
}

/**
 * The overrides of a repository as a semantic table with a caption (E18-S08), newest first, as the server gave them: the full commit
 * id in `<code>`, who recorded it (the login through `UserText` and the numeric GitHub id in `<code>`), when (UTC), and the reason through
 * `UserText`. The last column holds "Remove" and nothing else: the list never offers editing.
 */
export function OverridesTable({ items, remove }: OverridesTableProps) {
  const t = useT();
  const columns: readonly DataColumn<CommitOverride>[] = [
    {
      id: 'commit',
      header: t('pending.overrides.col.commit'),
      render: ({ commitSha }) => <code className="break-all">{commitSha}</code>,
    },
    {
      id: 'createdBy',
      header: t('pending.overrides.col.createdBy'),
      render: ({ createdBy }) => (
        <span className="flex flex-col">
          <UserText>{createdBy.login}</UserText>
          <code className="text-fg-muted">{createdBy.githubId}</code>
        </span>
      ),
    },
    {
      id: 'created',
      header: t('pending.overrides.col.created'),
      render: ({ createdAt }) => <Timestamp value={createdAt} utc />,
    },
    { id: 'reason', header: t('pending.overrides.col.reason'), userText: (item) => item.reason },
    {
      id: 'actions',
      header: t('pending.overrides.col.actions'),
      render: (item) => <RemoveOverride {...remove} item={item} />,
    },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable
        caption={t('pending.overrides.caption')}
        columns={columns}
        rows={items}
        rowKey={(item) => String(item.id)}
      />
    </div>
  );
}
