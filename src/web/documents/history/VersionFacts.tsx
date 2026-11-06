// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { Timestamp } from '../../i18n/Timestamp.tsx';
import { UserText } from '../../ui/index.ts';
import type { VersionDetail } from './history-queries.ts';
import { PublishedBy } from './PublishedBy.tsx';

export interface VersionFactsProps {
  readonly version: VersionDetail;
}

/**
 * What a version is (E18-S11): when and by whom it was published, why (the whole rationale through `UserText`), how many signatures
 * stand on exactly this version, and the whole SHA-256 of its text in `<code>`, which is what a signature records.
 */
export function VersionFacts({ version }: VersionFactsProps) {
  const t = useT();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt>{t('history.viewer.facts.published')}</dt>
      <dd>
        <Timestamp value={version.publishedAt} utc />
      </dd>
      <dt>{t('history.viewer.facts.publishedBy')}</dt>
      <dd>
        <PublishedBy by={version.publishedBy} />
      </dd>
      <dt>{t('history.viewer.facts.rationale')}</dt>
      <dd>
        <UserText>{version.rationale}</UserText>
      </dd>
      <dt>{t('history.viewer.facts.signatures')}</dt>
      <dd>{version.signatureCount}</dd>
      <dt>{t('history.viewer.facts.hash')}</dt>
      <dd>
        <code className="font-mono text-sm break-all">{version.contentSha256}</code>
      </dd>
    </dl>
  );
}
