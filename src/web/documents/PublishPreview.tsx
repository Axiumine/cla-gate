// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ContentHash } from './ContentHash.tsx';
import { formatVersion, type VersionNumber } from './version-number.ts';

export interface PublishPreviewProps {
  /** The number the version would take, from the active version and the kind of change. Display only: the server numbers it. */
  readonly version: VersionNumber;
  /** The saved draft, which the version is made from. */
  readonly text: string;
}

/** What the person is about to publish: the number it would get, and the SHA-256 of the text computed in this browser. */
export function PublishPreview({ version, text }: PublishPreviewProps) {
  const t = useT();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt>{t('publish.result')}</dt>
      <dd>
        {t('publish.result.value', { version: formatVersion(version) })}
        <span className="block text-sm text-fg-muted">{t('publish.result.note')}</span>
      </dd>
      <dt>{t('publish.hash')}</dt>
      <dd>
        <ContentHash text={text} />
      </dd>
    </dl>
  );
}
