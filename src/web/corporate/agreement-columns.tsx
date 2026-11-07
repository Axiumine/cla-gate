// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CorporateAgreement } from '../../shared/corporate.ts';
import { type Messages, Timestamp, type Translate, useT } from '../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import type { DataColumn } from '../ui/data-table-columns.ts';
import { UserText } from '../ui/UserText.tsx';

/** The text of a company or a title: user text, or a word for the one that was erased from the records. */
function Erasable({ value }: { readonly value: string | null }) {
  const t = useT();
  return value === null ? <span>{t('corporate.agreements.erased')}</span> : <UserText>{value}</UserText>;
}

/** The columns of the list: user text goes through `UserText` (a `userText` column, or `Erasable`), everything else is rendered. */
export function agreementColumns(t: Translate<Messages>): readonly DataColumn<CorporateAgreement>[] {
  return [
    { id: 'company', header: t('corporate.agreements.company'), render: (row) => <Erasable value={row.companyName} /> },
    {
      id: 'title',
      header: t('corporate.agreements.titleColumn'),
      render: (row) => <Erasable value={row.signatoryTitle} />,
    },
    { id: 'document', header: t('corporate.agreements.document'), userText: (row) => row.document.name },
    {
      id: 'organisation',
      header: t('corporate.agreements.organisation'),
      userText: (row) => row.installation.accountLogin,
    },
    {
      id: 'signed',
      header: t('corporate.agreements.signed'),
      render: (row) => <Timestamp value={row.signedAt} utc />,
    },
    { id: 'approvals', header: t('corporate.agreements.approvals'), render: (row) => row.activeApprovalCount },
    {
      id: 'status',
      header: t('corporate.agreements.status'),
      render: (row) => <Badge status={row.revoked ? 'revoked' : 'active'} />,
    },
  ];
}
