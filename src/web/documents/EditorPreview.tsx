// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useDeferredValue } from 'react';
import { MarkdownView } from '../components/markdown/MarkdownView.tsx';
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';

export interface EditorPreviewProps {
  readonly text: string;
}

/**
 * The text as contributors read it (E18-S05): the same `MarkdownView` the sign page uses, so what is previewed is what is signed.
 * Drawing a text costs more than linear time for some texts, so the preview follows the typing at a lower priority
 * (`useDeferredValue`): a key press shows in the field at once and the preview catches up.
 */
export function EditorPreview({ text }: EditorPreviewProps) {
  const t = useT();
  const shown = useDeferredValue(text);
  return (
    <section aria-label={t('editor.preview.title')} className="flex flex-col gap-3">
      <Heading level={2}>{t('editor.preview.title')}</Heading>
      <p className="text-sm text-fg-muted">{t('editor.preview.note')}</p>
      <div className="rounded-md border border-line bg-surface p-4">
        {shown.trim() === '' ? (
          <p className="text-fg-muted">{t('editor.preview.empty')}</p>
        ) : (
          <MarkdownView source={shown} headingLevel={3} />
        )}
      </div>
    </section>
  );
}
