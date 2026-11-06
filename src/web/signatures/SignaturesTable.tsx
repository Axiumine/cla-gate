// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { Badge, type DataColumn, DataTable } from '../ui/index.ts';
import type { EraseActionProps } from './erase/EraseAction.tsx';
import type { RevokeActionProps } from './RevokeAction.tsx';
import { SignatureActions } from './SignatureActions.tsx';
import { GithubIdCell, SignerCell, SourceCell } from './SignatureCells.tsx';
import type { Signature } from './signature-queries.ts';

/** What a table needs to offer the revocation of its rows. */
export interface RevokeControl
  extends Pick<RevokeActionProps, 'installationId' | 'suspended' | 'onOutcome' | 'onVanished'> {
  /** Whether the viewer may revoke the signatures of the document with this id (their role and the scope of the document). */
  readonly allowed: (documentId: number) => boolean;
}

/** What a table needs to offer the erasure of the personal data of the signers of its rows (E18-S14). */
export type EraseControl = Pick<EraseActionProps, 'installationId' | 'suspended' | 'onDone'>;

export interface SignaturesTableProps {
  readonly items: readonly Signature[];
  /** The revocation of the rows the viewer may revoke. */
  readonly revoke: RevokeControl;
  /** The erasure of personal data on every row, for an org admin; absent for any other viewer. */
  readonly erase?: EraseControl | undefined;
}

/**
 * The signatures of a page as a semantic table with a caption (E18-S07), in the order the server gave, newest first. The signer, the
 * document and the repository are text a person controls and are drawn through `UserText`; the verified email is not in the table (it is in
 * the detail of a row). The last column has "Details" on every row, "Revoke" on the rows the viewer may revoke and, for an org admin, "Erase
 * personal data" (E18-S14), which reads "Erased" once the signer's personal data is gone.
 */
export function SignaturesTable({ items, revoke, erase }: SignaturesTableProps) {
  const t = useT();
  const columns: readonly DataColumn<Signature>[] = [
    { id: 'signer', header: t('signatures.col.signer'), render: (item) => <SignerCell item={item} /> },
    { id: 'githubId', header: t('signatures.col.githubId'), render: (item) => <GithubIdCell item={item} /> },
    { id: 'document', header: t('signatures.col.document'), userText: (item) => item.document.name },
    {
      id: 'version',
      header: t('signatures.col.version'),
      render: ({ version }) => (
        <span>
          {version.major}.{version.minor}
        </span>
      ),
    },
    {
      id: 'signed',
      header: t('signatures.col.signed'),
      render: ({ signedAt }) => <Timestamp value={signedAt} utc />,
    },
    { id: 'source', header: t('signatures.col.source'), render: (item) => <SourceCell item={item} /> },
    { id: 'status', header: t('signatures.col.status'), render: ({ state }) => <Badge status={state} /> },
    {
      id: 'actions',
      header: t('signatures.col.actions'),
      render: (item) => <SignatureActions item={item} revoke={revoke} erase={erase} />,
    },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable caption={t('signatures.caption')} columns={columns} rows={items} rowKey={(item) => String(item.id)} />
    </div>
  );
}
