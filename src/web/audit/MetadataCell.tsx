// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useId, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/index.ts';
import type { AuditEvent } from './audit-queries.ts';
import { metadataText } from './metadata-text.ts';

export interface MetadataCellProps {
  readonly event: AuditEvent;
}

/**
 * The metadata of an audit row (E18-S09): "None" when it is empty, else a button that opens it. Opened, it is the key-sorted object as
 * text in a `<pre>` (never parsed as HTML or markdown) whose long words break wherever they must, so no value can widen the table.
 * The button says which event it opens, so a list of them can be told apart, and it is the only control of the cell.
 */
export function MetadataCell({ event }: MetadataCellProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const blockId = useId();
  if (Object.keys(event.metadata).length === 0) {
    return <span>{t('audit.metadata.none')}</span>;
  }
  return (
    <div className="flex flex-col gap-2">
      <Button
        aria-expanded={open}
        aria-controls={open ? blockId : undefined}
        aria-label={t(open ? 'audit.metadata.hideLabel' : 'audit.metadata.showLabel', { id: event.id })}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {t(open ? 'audit.metadata.hide' : 'audit.metadata.show')}
      </Button>
      {open ? (
        <pre id={blockId} dir="ltr" className="font-mono text-xs whitespace-pre-wrap wrap-anywhere">
          {metadataText(event.metadata)}
        </pre>
      ) : null}
    </div>
  );
}
