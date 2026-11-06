// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import { formatVersion } from './version-number.ts';

export interface VersionLabelProps {
  /** The active version of a document, or `null` when it has none. */
  readonly version: { readonly major: number; readonly minor: number; readonly publishedAt: string } | null;
}

/** The active version of a document as `major.minor` with the time it was published, in UTC (evidence time); or "Not published". */
export function VersionLabel({ version }: VersionLabelProps) {
  const t = useT();
  if (version === null) {
    return <span className="text-fg-muted">{t('documents.version.none')}</span>;
  }
  return (
    <span>
      <span className="font-medium">{formatVersion(version)}</span>{' '}
      <span className="text-fg-muted">
        <Timestamp value={version.publishedAt} utc />
      </span>
    </span>
  );
}
