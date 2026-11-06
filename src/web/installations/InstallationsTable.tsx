// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import type { InstallationSummary } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { type DataColumn, DataTable } from '../ui/index.ts';
import { UserText } from '../ui/UserText.tsx';
import { accountTypeKey } from './account-type.ts';
import { RoleBadge } from './RoleBadge.tsx';

export interface InstallationsTableProps {
  readonly installations: readonly InstallationSummary[];
}

/**
 * The installations the person administers as a semantic table with a caption (E18-S04). The account login is text a person
 * controls and is drawn through `UserText`, as the link into the installation; the type, the counts, the role and the
 * `Suspended` badge are the server's facts in the catalog's words.
 */
export function InstallationsTable({ installations }: InstallationsTableProps) {
  const t = useT();
  const columns: readonly DataColumn<InstallationSummary>[] = [
    {
      id: 'account',
      header: t('installations.col.account'),
      render: (installation) => (
        <Link
          to="/installations/$installationId"
          params={{ installationId: installation.id }}
          className="underline underline-offset-2"
        >
          <UserText>{installation.accountLogin}</UserText>
        </Link>
      ),
    },
    {
      id: 'type',
      header: t('installations.col.type'),
      render: ({ accountType }) => <span>{t(accountTypeKey(accountType))}</span>,
    },
    {
      id: 'repositories',
      header: t('installations.col.repositories'),
      render: ({ repositoryCount }) => repositoryCount,
    },
    { id: 'enabled', header: t('installations.col.enabled'), render: ({ enabledCount }) => enabledCount },
    {
      id: 'role',
      header: t('installations.col.role'),
      render: ({ role, suspended }) => (
        <div className="flex flex-wrap items-center gap-1">
          <RoleBadge role={role} />
          {suspended ? <Badge status="suspended" /> : null}
        </div>
      ),
    },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable
        caption={t('installations.caption')}
        captionVisible
        columns={columns}
        rows={installations}
        rowKey={(installation) => String(installation.id)}
      />
    </div>
  );
}
