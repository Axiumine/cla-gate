// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import type { Published } from './editor-state.ts';
import { formatVersion } from './version-number.ts';

export interface PublishedNoticeProps {
  readonly published: Published;
}

/**
 * What a publish did (E18-S05): the version that is now active and, when it asks everyone to sign again, that the checks on open
 * pull requests will be evaluated again. A minor version says that the signatures stay valid.
 */
export function PublishedNotice({ published }: PublishedNoticeProps) {
  const t = useT();
  return (
    <>
      <p className="font-semibold">{t('editor.published.title', { version: formatVersion(published.version) })}</p>
      <p>{published.requiresResigning ? t('editor.published.resign') : t('editor.published.same')}</p>
    </>
  );
}
