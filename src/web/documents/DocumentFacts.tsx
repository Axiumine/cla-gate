// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import type { DocumentDetail } from './document-queries.ts';
import type { ActiveVersion } from './editor-state.ts';
import { VersionLabel } from './VersionLabel.tsx';

export interface DocumentFactsProps {
  readonly document: DocumentDetail;
  /** The version in force now, which a publish changes: not the one the document was opened with. */
  readonly active: ActiveVersion | null;
  /** Whether a draft is saved on the server, which a save and a discard change. */
  readonly hasDraft: boolean;
}

/** What the document is: its scope, its kind, the version in force with the time it was published, and whether a draft is saved. */
export function DocumentFacts({ document, active, hasDraft }: DocumentFactsProps) {
  const t = useT();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt>{t('document.facts.scope')}</dt>
      <dd>{t(document.scope === 'installation' ? 'documents.scope.installation' : 'documents.scope.repository')}</dd>
      <dt>{t('document.facts.kind')}</dt>
      <dd>{t(`documents.kind.${document.kind}`)}</dd>
      <dt>{t('document.facts.version')}</dt>
      <dd>
        <VersionLabel version={active} />
      </dd>
      <dt>{t('document.facts.draft')}</dt>
      <dd>{hasDraft ? <Badge status="draft">{t('documents.draftSaved')}</Badge> : t('document.facts.noDraft')}</dd>
    </dl>
  );
}
