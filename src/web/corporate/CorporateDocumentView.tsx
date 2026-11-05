// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { CorporateDocumentResponse } from '../../shared/corporate.ts';
import { useFormatters, useT } from '../i18n/index.ts';
import { UserText } from '../ui/UserText.tsx';
import { ClaText } from './ClaText.tsx';
import { CorporateSignForm } from './CorporateSignForm.tsx';

export interface CorporateDocumentViewProps {
  readonly document: CorporateDocumentResponse;
  /** Loads the text again: what a person does when the version moved on while they read. */
  readonly onReload: () => void;
}

/**
 * The corporate CLA in force for a repository (E21-S02), as the server stored it: what it is, the version and when it was published,
 * the text, and the form that signs it. The names of the repository and of the document are user text.
 */
export function CorporateDocumentView({ document, onReload }: CorporateDocumentViewProps) {
  const t = useT();
  const { formatUtc } = useFormatters();
  return (
    <>
      <p>{t('corporate.sign.intro')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-medium">{t('corporate.sign.repository')}</dt>
        <dd>
          <UserText>{document.repository.fullName}</UserText>
        </dd>
        <dt className="font-medium">
          <UserText>{document.document.name}</UserText>
        </dt>
        <dd>
          {t('corporate.sign.version', {
            major: document.major,
            minor: document.minor,
            date: formatUtc(document.publishedAt),
          })}
        </dd>
      </dl>
      <ClaText markdown={document.contentMd} />
      <CorporateSignForm document={document} onReload={onReload} />
    </>
  );
}
