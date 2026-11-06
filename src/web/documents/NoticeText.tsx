// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import type { Notice } from './editor-state.ts';
import { PublishedNotice } from './PublishedNotice.tsx';

export interface NoticeTextProps {
  readonly notice: Notice;
}

/** The words of a notice of the editor (E18-S05): one `switch` over the kinds of notice, with no default, so a new kind fails `tsc` until it has words. */
export function NoticeText({ notice }: NoticeTextProps) {
  const t = useT();
  switch (notice.type) {
    case 'published':
      return <PublishedNotice published={notice.published} />;
    case 'saved':
      return <>{t('editor.saved')}</>;
    case 'discarded':
      return <>{t('editor.discarded')}</>;
    case 'loadedDraft':
      return <>{t('editor.loaded')}</>;
    case 'loadedActive':
      return <>{t('editor.loadedActive')}</>;
  }
}
