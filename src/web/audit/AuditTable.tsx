// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { type DataColumn, DataTable } from '../ui/index.ts';
import type { AuditEvent } from './audit-queries.ts';
import { ActionCell, ActorCell, SubjectCell, TimeCell } from './EventCells.tsx';
import { MetadataCell } from './MetadataCell.tsx';

export interface AuditTableProps {
  readonly items: readonly AuditEvent[];
}

/**
 * The audit events of a page as a semantic table with a caption (E18-S09), newest first as the server gave them: the time (UTC), the
 * actor, the action, the subject and the metadata. The table is read-only: its one control is the button that opens a row's metadata.
 */
export function AuditTable({ items }: AuditTableProps) {
  const t = useT();
  const columns: readonly DataColumn<AuditEvent>[] = [
    { id: 'time', header: t('audit.col.time'), render: (event) => <TimeCell event={event} /> },
    { id: 'actor', header: t('audit.col.actor'), render: (event) => <ActorCell event={event} /> },
    { id: 'action', header: t('audit.col.action'), render: (event) => <ActionCell event={event} /> },
    { id: 'subject', header: t('audit.col.subject'), render: (event) => <SubjectCell event={event} /> },
    { id: 'metadata', header: t('audit.col.metadata'), render: (event) => <MetadataCell event={event} /> },
  ];
  return (
    <div className="overflow-x-auto">
      <DataTable caption={t('audit.caption')} columns={columns} rows={items} rowKey={(event) => String(event.id)} />
    </div>
  );
}
