// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Badge, type DataColumn, DataTable } from '../ui/index.ts';
import { ClaCell } from './ClaCell.tsx';
import { RepositoryActions } from './RepositoryActions.tsx';
import type { Repository } from './repository-queries.ts';
import type { RowActions } from './row-actions.ts';

export interface RepositoriesTableProps {
  readonly items: readonly Repository[];
  /** What the viewer may do with the rows they administer. */
  readonly actions: RowActions;
}

/**
 * The repositories of a page as a semantic table with a caption (E18-S10), in the order the server gave, by name. The full name and the
 * name of the document are text a person controls and are drawn through `UserText`; the status is a badge in words. The last column is
 * for the actions, which are on the rows the viewer administers (`canAdminister`) and nowhere else: when no row of the page is one, the
 * column is not there.
 */
export function RepositoriesTable({ items, actions }: RepositoriesTableProps) {
  const t = useT();
  const columns: readonly DataColumn<Repository>[] = [
    { id: 'name', header: t('repositories.col.name'), userText: ({ fullName }) => fullName },
    {
      id: 'status',
      header: t('repositories.col.status'),
      render: ({ enabled }) => <Badge status={enabled ? 'enabled' : 'disabled'} />,
    },
    { id: 'cla', header: t('repositories.col.cla'), render: ({ document }) => <ClaCell document={document} /> },
    ...(items.some(({ canAdminister }) => canAdminister)
      ? [
          {
            id: 'actions',
            header: t('repositories.col.actions'),
            render: (repository: Repository) =>
              repository.canAdminister ? <RepositoryActions actions={actions} repository={repository} /> : null,
          },
        ]
      : []),
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable caption={t('repositories.caption')} columns={columns} rows={items} rowKey={({ id }) => String(id)} />
    </div>
  );
}
