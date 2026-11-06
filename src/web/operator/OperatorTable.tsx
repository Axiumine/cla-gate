// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { useT } from '../i18n/index.ts';
import { accountTypeKey } from '../installations/account-type.ts';
import { Badge } from '../ui/Badge.tsx';
import { type DataColumn, DataTable } from '../ui/index.ts';
import { AdmissionCell } from './AdmissionCell.tsx';
import type { OperatorInstallation } from './operator-queries.ts';
import { RepositoryCounts } from './RepositoryCounts.tsx';
import { TimesCell } from './TimesCell.tsx';

export interface OperatorTableProps {
  readonly installations: readonly OperatorInstallation[];
}

/**
 * The installations of the instance as a semantic table with a caption (E18-S13). The account login is text a person controls and
 * is drawn by the table through `UserText`; the GitHub installation id is a number in `<code>`, and the rest are the server's
 * facts in the catalog's words. A row carries no signature, signer or personal data, because the endpoint carries none.
 */
export function OperatorTable({ installations }: OperatorTableProps) {
  const t = useT();
  const columns: readonly DataColumn<OperatorInstallation>[] = [
    { id: 'account', header: t('operator.col.account'), userText: ({ accountLogin }) => accountLogin },
    {
      id: 'type',
      header: t('operator.col.type'),
      render: ({ accountType }) => <span>{t(accountTypeKey(accountType))}</span>,
    },
    {
      id: 'installation',
      header: t('operator.col.installation'),
      render: ({ githubInstallationId }) => <code>{githubInstallationId}</code>,
    },
    {
      id: 'admission',
      header: t('operator.col.admission'),
      render: (installation) => <AdmissionCell installation={installation} />,
    },
    {
      id: 'state',
      header: t('operator.col.state'),
      render: ({ tenantState }) => <Badge status={tenantState} />,
    },
    {
      id: 'times',
      header: t('operator.col.times'),
      render: (installation) => <TimesCell installation={installation} />,
    },
    {
      id: 'repositories',
      header: t('operator.col.repositories'),
      render: ({ repositories }) => <RepositoryCounts repositories={repositories} />,
    },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable
        caption={t('operator.caption')}
        captionVisible
        columns={columns}
        rows={installations}
        rowKey={({ githubInstallationId }) => String(githubInstallationId)}
      />
    </div>
  );
}
