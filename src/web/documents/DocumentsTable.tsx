// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import type { documentListRoute } from '../../shared/cla-routes.ts';
import type { SuccessOf } from '../../shared/contract.ts';
import { useT } from '../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { type DataColumn, DataTable, UserText } from '../ui/index.ts';
import { VersionLabel } from './VersionLabel.tsx';

type Listed = SuccessOf<typeof documentListRoute>['documents'][number];

export interface DocumentsTableProps {
  readonly installationId: number;
  readonly documents: readonly Listed[];
}

/**
 * The documents of an installation (E18-S05): the name, which links to the editor, the scope (the whole installation, or the full
 * name of a repository), the kind, the active version with the time it was published, and a "Draft saved" badge. Names and
 * repository names are text a person controls and go through `UserText`.
 */
export function DocumentsTable({ installationId, documents }: DocumentsTableProps) {
  const t = useT();
  const columns: readonly DataColumn<Listed>[] = [
    {
      id: 'name',
      header: t('documents.col.name'),
      render: (document) => (
        <Link
          to="/installations/$installationId/documents/$documentId"
          params={{ installationId, documentId: document.id }}
          className="underline underline-offset-2"
        >
          <UserText>{document.name}</UserText>
        </Link>
      ),
    },
    {
      id: 'scope',
      header: t('documents.col.scope'),
      render: ({ repositoryFullName }) =>
        repositoryFullName === null ? (
          <span>{t('documents.scope.installation')}</span>
        ) : (
          <UserText>{repositoryFullName}</UserText>
        ),
    },
    { id: 'kind', header: t('documents.col.kind'), render: ({ kind }) => <span>{t(`documents.kind.${kind}`)}</span> },
    {
      id: 'version',
      header: t('documents.col.version'),
      render: ({ activeVersion }) => <VersionLabel version={activeVersion} />,
    },
    {
      id: 'draft',
      header: t('documents.col.draft'),
      render: ({ hasDraft }) => (hasDraft ? <Badge status="draft">{t('documents.draftSaved')}</Badge> : null),
    },
  ];
  return (
    <DataTable caption={t('documents.caption')} columns={columns} rows={documents} rowKey={({ id }) => String(id)} />
  );
}
