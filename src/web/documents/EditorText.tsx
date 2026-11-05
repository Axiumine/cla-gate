// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMemo } from 'react';
import { CLA_TEXT_MAX_BYTES, canonicalise } from '../../shared/cla-text.ts';
import { useFormatters, useT } from '../i18n/index.ts';
import { Field, Textarea } from '../ui/index.ts';

export interface EditorTextProps {
  readonly text: string;
  /** The rule the last save broke about the text, in words, or `undefined`. */
  readonly error: string | undefined;
  /** The installation is suspended: the text can be read and not changed. */
  readonly readOnly: boolean;
  readonly onChange: (text: string) => void;
}

/** The size of `text` as the server counts it: the UTF-8 bytes of the canonical text, and nothing for no text at all. */
function sizeOf(text: string): number {
  return text === '' ? 0 : new TextEncoder().encode(canonicalise(text)).byteLength;
}

/**
 * The text of the CLA in a monospace field (E18-S05) with its size against the limit of the server (200 KiB of UTF-8, as the server
 * counts it); over the limit says so, and the save is still the server's decision. A rule that a save broke about the text is shown
 * under the field with the field marked invalid.
 */
export function EditorText({ text, error, readOnly, onChange }: EditorTextProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const size = useMemo(() => sizeOf(text), [text]);
  const sizes = { size: formatNumber(size), limit: formatNumber(CLA_TEXT_MAX_BYTES) };
  return (
    <Field
      label={t('editor.text.label')}
      description={size > CLA_TEXT_MAX_BYTES ? t('editor.text.sizeOver', sizes) : t('editor.text.size', sizes)}
      error={error}
    >
      <Textarea
        value={text}
        readOnly={readOnly}
        rows={24}
        spellCheck={false}
        className="font-mono"
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}
