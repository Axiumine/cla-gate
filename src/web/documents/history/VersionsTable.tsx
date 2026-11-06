// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { Timestamp } from '../../i18n/Timestamp.tsx';
import { Badge, Button, type DataColumn, DataTable } from '../../ui/index.ts';
import { formatVersion } from '../version-number.ts';
import type { VersionSummary } from './history-queries.ts';
import { PublishedBy } from './PublishedBy.tsx';
import { RationaleCell } from './RationaleCell.tsx';

/** How many characters of the SHA-256 the list shows: enough to tell versions apart, and the viewer has the whole hash. */
const HASH_PREFIX = 12;

export interface VersionsTableProps {
  readonly items: readonly VersionSummary[];
  /** "View" on a row asks for that version's text. */
  readonly onView: (versionId: number) => void;
}

/**
 * The versions of a page as a semantic table with a caption (E18-S11), newest first as the server gave them: the number, the time
 * (UTC), who published it, why, the start of the hash, how many signatures stand on exactly this version, and an `Active` badge on
 * the one the document points at. A version never changes, so a row has no control that edits or deletes it: its one control is
 * "View", which names the version it opens.
 */
export function VersionsTable({ items, onView }: VersionsTableProps) {
  const t = useT();
  const columns: readonly DataColumn<VersionSummary>[] = [
    { id: 'version', header: t('history.col.version'), render: (row) => <strong>{formatVersion(row)}</strong> },
    {
      id: 'published',
      header: t('history.col.published'),
      render: (row) => <Timestamp value={row.publishedAt} utc />,
    },
    { id: 'by', header: t('history.col.publishedBy'), render: (row) => <PublishedBy by={row.publishedBy} /> },
    { id: 'rationale', header: t('history.col.rationale'), render: (row) => <RationaleCell text={row.rationale} /> },
    {
      id: 'hash',
      header: t('history.col.hash'),
      render: (row) => <code className="font-mono text-xs">{row.contentSha256.slice(0, HASH_PREFIX)}</code>,
    },
    { id: 'signatures', header: t('history.col.signatures'), render: (row) => row.signatureCount },
    {
      id: 'status',
      header: t('history.col.status'),
      render: (row) => (row.active ? <Badge status="active" /> : null),
    },
    {
      id: 'actions',
      header: t('history.col.actions'),
      render: (row) => (
        <Button
          aria-label={t('history.view.label', { version: formatVersion(row) })}
          onClick={() => {
            onView(row.id);
          }}
        >
          {t('history.view')}
        </Button>
      ),
    },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable caption={t('history.caption')} columns={columns} rows={items} rowKey={(row) => String(row.id)} />
    </div>
  );
}
