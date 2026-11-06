// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { RepositoryPage } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { EmptyState } from '../states/EmptyState.tsx';
import { Badge } from '../ui/Badge.tsx';
import { type DataColumn, DataTable } from '../ui/index.ts';

type Repository = RepositoryPage['items'][number];

export interface RepositoryOverviewProps {
  readonly page: RepositoryPage;
}

/**
 * The first repositories of a tenant, with whether each one enforces the CLA (E18-S04). The name is text a person controls and
 * goes through `UserText` by the table. It is a glance, not the repository screen (E18-S10): a longer list says so.
 */
export function RepositoryOverview({ page }: RepositoryOverviewProps) {
  const t = useT();
  if (page.items.length === 0) {
    return (
      <EmptyState
        level={3}
        title={t('installation.repositories.empty.title')}
        description={t('installation.repositories.empty.description')}
      />
    );
  }
  const columns: readonly DataColumn<Repository>[] = [
    { id: 'name', header: t('installation.repositories.col.name'), userText: ({ fullName }) => fullName },
    {
      id: 'status',
      header: t('installation.repositories.col.status'),
      render: ({ enabled }) => <Badge status={enabled ? 'enabled' : 'disabled'} />,
    },
  ];
  return (
    <>
      <DataTable
        caption={t('installation.repositories.caption')}
        columns={columns}
        rows={page.items}
        rowKey={({ id }) => String(id)}
      />
      {page.nextCursor === null ? null : (
        <p className="text-fg-muted">{t('installation.repositories.more', { count: page.items.length })}</p>
      )}
    </>
  );
}
