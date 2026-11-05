// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { Badge, type DataColumn, DataTable } from '../ui/index.ts';
import { RevokeAction, type RevokeActionProps } from './RevokeAction.tsx';
import { GithubIdCell, SignerCell, SourceCell } from './SignatureCells.tsx';
import { SignatureDetails } from './SignatureDetails.tsx';
import type { Signature } from './signature-queries.ts';

/** What a table needs to offer the revocation of its rows. */
export interface RevokeControl
  extends Pick<RevokeActionProps, 'installationId' | 'suspended' | 'onOutcome' | 'onVanished'> {
  /** Whether the viewer may revoke the signatures of the document with this id (their role and the scope of the document). */
  readonly allowed: (documentId: number) => boolean;
}

export interface SignaturesTableProps {
  readonly items: readonly Signature[];
  /** The revocation of the rows the viewer may revoke. */
  readonly revoke: RevokeControl;
}

/**
 * The signatures of a page as a semantic table with a caption (E18-S07), in the order the server gave, newest first. The signer, the
 * document and the repository are text a person controls and are drawn through `UserText`; the verified email is not in the table (it is in
 * the detail of a row). The last column has "Details" on every row and "Revoke" on the rows the viewer may revoke.
 */
export function SignaturesTable({ items, revoke }: SignaturesTableProps) {
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
      render: (item) => (
        <div className="flex flex-wrap gap-2">
          <SignatureDetails item={item} />
          {revoke.allowed(item.document.id) ? (
            <RevokeAction
              installationId={revoke.installationId}
              item={item}
              suspended={revoke.suspended}
              onOutcome={revoke.onOutcome}
              onVanished={revoke.onVanished}
            />
          ) : null}
        </div>
      ),
    },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable caption={t('signatures.caption')} columns={columns} rows={items} rowKey={(item) => String(item.id)} />
    </div>
  );
}
