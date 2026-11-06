// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { UserText } from '../ui/index.ts';
import type { AttachedDocument } from './repository-queries.ts';

export interface ClaCellProps {
  /** The document the repository enforces, as the list shows it. */
  readonly document: AttachedDocument | null;
}

/** The CLA of a repository (E18-S10): the name of the attached document through `UserText` with the version in force as `major.minor`, or that none is attached. */
export function ClaCell({ document }: ClaCellProps) {
  const t = useT();
  if (document === null) {
    return <span className="text-fg-muted">{t('repositories.cla.none')}</span>;
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <UserText>{document.name}</UserText>
      <span className="text-fg-muted">
        {document.activeVersion === null
          ? t('repositories.cla.unpublished')
          : `${String(document.activeVersion.major)}.${String(document.activeVersion.minor)}`}
      </span>
    </span>
  );
}
