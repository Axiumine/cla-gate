// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { type DataColumn, DataTable } from '../ui/index.ts';
import { PullRequestCell } from './PullRequestCell.tsx';
import type { PendingPr } from './pending-queries.ts';
import { ReasonList } from './ReasonList.tsx';
import type { RecordActions } from './RecordOverride.tsx';
import { shortSha } from './short-sha.ts';

export interface PendingTableProps {
  readonly items: readonly PendingPr[];
  /** What the rows offer for the recording of an override. */
  readonly actions: RecordActions;
}

/**
 * The pending pull requests of a page as a semantic table with a caption (E18-S08), the most recently checked first, as the server gave
 * them: the repository (text a person controls, drawn through `UserText`), the pull request, the first seven characters of its head
 * commit in `<code>`, the time of the last evaluation (UTC) and the reasons it is blocked.
 */
export function PendingTable({ items, actions }: PendingTableProps) {
  const t = useT();
  const columns: readonly DataColumn<PendingPr>[] = [
    { id: 'repository', header: t('pending.col.repository'), userText: (item) => item.repository.fullName },
    { id: 'pr', header: t('pending.col.pr'), render: (item) => <PullRequestCell item={item} /> },
    { id: 'commit', header: t('pending.col.commit'), render: ({ headSha }) => <code>{shortSha(headSha)}</code> },
    {
      id: 'evaluated',
      header: t('pending.col.evaluated'),
      render: ({ evaluatedAt }) => <Timestamp value={evaluatedAt} utc />,
    },
    { id: 'reasons', header: t('pending.col.reasons'), render: (item) => <ReasonList item={item} actions={actions} /> },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable
        caption={t('pending.caption')}
        columns={columns}
        rows={items}
        rowKey={(item) => String(item.evaluationId)}
      />
    </div>
  );
}
