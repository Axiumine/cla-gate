// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { Button } from '../../ui/index.ts';
import { InvalidateAction } from '../invalidate/InvalidateAction.tsx';
import type { InvalidateControl } from '../invalidate/use-invalidate-control.ts';
import { formatVersion } from '../version-number.ts';
import type { VersionSummary } from './history-queries.ts';

export interface VersionActionsProps {
  readonly row: VersionSummary;
  /** "View" asks for that version's text. */
  readonly onView: (versionId: number) => void;
  /** The invalidation of a major, offered on the first version of each major; absent for a viewer who may not invalidate. */
  readonly invalidate: InvalidateControl | undefined;
}

/**
 * The last cell of a row of the versions (E18-S11, E18-S14): "View", which names the version it opens, and, on the first version of a
 * major (`N.0`, where the signatures of the major begin) for a viewer who may manage the document, "Invalidate signatures", which names
 * the major. Nothing on a version edits or deletes it.
 */
export function VersionActions({ row, onView, invalidate }: VersionActionsProps) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        aria-label={t('history.view.label', { version: formatVersion(row) })}
        onClick={() => {
          onView(row.id);
        }}
      >
        {t('history.view')}
      </Button>
      {invalidate === undefined || row.minor !== 0 ? null : (
        <InvalidateAction
          ids={invalidate.ids}
          major={row.major}
          documentName={invalidate.documentName}
          suspended={invalidate.suspended}
          onDone={(invalidated) => {
            invalidate.onOutcome({ major: row.major, invalidated });
          }}
        />
      )}
    </div>
  );
}
