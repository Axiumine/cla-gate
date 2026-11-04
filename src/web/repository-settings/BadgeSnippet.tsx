// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { copyToClipboard } from '../ui/clipboard.ts';
import { Field } from '../ui/Field.tsx';
import { Textarea } from '../ui/Textarea.tsx';

export interface BadgeSnippetProps {
  /** The Markdown the server built. */
  readonly markdown: string;
  /** The HTML the server built. */
  readonly html: string;
  /** Says a result in the live region of the screen. */
  readonly announce: (message: string) => void;
}

/** One form of the snippet: a read-only field and a "Copy" button that carries the name of the form, so two of them are not two identical "Copy"s. */
function Form(props: { readonly name: string; readonly text: string; readonly announce: (message: string) => void }) {
  const t = useT();
  const { name, text, announce } = props;
  const copy = () => {
    void copyToClipboard(text).then((copied) => {
      announce(copied ? t('repository.badge.copied', { name }) : t('repository.badge.copyUnavailable'));
    });
  };
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="w-full">
        <Field label={name}>
          <Textarea readOnly rows={3} spellCheck={false} value={text} />
        </Field>
      </div>
      <Button variant="secondary" aria-label={t('repository.badge.copyNamed', { name })} onClick={copy}>
        {t('repository.badge.copy')}
      </Button>
    </div>
  );
}

/**
 * The snippet of the README badge (E22-S03): the Markdown and the HTML the server built from the public address and the GitHub id of
 * the repository, each in a read-only field with a button that copies it. The text is shown as a value of a field and never as
 * markup, and the result of a copy is said in the polite live region of the screen.
 */
export function BadgeSnippet({ markdown, html, announce }: BadgeSnippetProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <Form name={t('repository.badge.markdown')} text={markdown} announce={announce} />
      <Form name={t('repository.badge.html')} text={html} announce={announce} />
    </div>
  );
}
