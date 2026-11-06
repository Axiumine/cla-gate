// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Timestamp, useT } from '../i18n/index.ts';
import { type DataColumn, DataTable } from '../ui/index.ts';
import { type Item, Organisation, Source } from './SignatureCells.tsx';
import { SignatureStatus } from './SignatureStatus.tsx';

export interface SignaturesTableProps {
  readonly items: readonly Item[];
}

/**
 * The signatures of the person as a semantic table with a caption (E18-S03). The document name, the account login and the
 * repository are text a person controls and are drawn through `UserText`; the rows are in the order the server gave, newest first.
 */
export function SignaturesTable({ items }: SignaturesTableProps) {
  const t = useT();
  const columns: readonly DataColumn<Item>[] = [
    { id: 'document', header: t('me.signatures.col.document'), userText: (item) => item.document.name },
    { id: 'organisation', header: t('me.signatures.col.organisation'), render: (item) => <Organisation item={item} /> },
    {
      id: 'version',
      header: t('me.signatures.col.version'),
      render: ({ version }) => (
        <span>
          {version.major}.{version.minor}
        </span>
      ),
    },
    {
      id: 'signed',
      header: t('me.signatures.col.signed'),
      render: ({ signedAt }) => <Timestamp value={signedAt} utc />,
    },
    { id: 'source', header: t('me.signatures.col.source'), render: (item) => <Source item={item} /> },
    { id: 'status', header: t('me.signatures.col.status'), render: (item) => <SignatureStatus item={item} /> },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable
        caption={t('me.signatures.caption')}
        captionVisible
        columns={columns}
        rows={items}
        rowKey={(item) => String(item.id)}
      />
    </div>
  );
}
