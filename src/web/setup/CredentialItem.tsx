// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { copyToClipboard } from '../ui/clipboard.ts';
import { Field } from '../ui/Field.tsx';
import { Textarea } from '../ui/Textarea.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import type { CredentialItemData } from './credential-items.ts';
import { saveAsFile } from './download-file.ts';

/** What a masked secret shows: a fixed run of bullets, so the field does not give away the length of the value, and the value is not in the page. */
const MASK = '•'.repeat(16);

export interface CredentialItemProps {
  readonly item: CredentialItemData;
  /** Says a result in the live region of the screen. */
  readonly announce: (message: string) => void;
}

/**
 * One credential (E19-S07): a read-only field (a secret shows bullets until "Reveal", and its value is not in the page
 * before that), "Copy" (the Clipboard API; the result is said in the live region, with a message of its own when the API is
 * not there) and "Download" (a Blob saved under the name of the file the value belongs in). The buttons carry the name of
 * the value, so a list of them is not a row of identical "Copy"s to a screen reader.
 */
export function CredentialItem({ item, announce }: CredentialItemProps) {
  const t = useT();
  const [revealed, setRevealed] = useState(false);
  const shown = item.secret && !revealed ? MASK : item.value;
  const name = item.label;
  const copy = () => {
    void copyToClipboard(item.value).then((copied) => {
      announce(copied ? t('setup.item.copied', { name }) : t('setup.item.copyUnavailable'));
    });
  };
  return (
    <div className="flex flex-col gap-2">
      <Field label={item.label}>
        {item.multiline ? (
          <Textarea readOnly rows={6} spellCheck={false} value={shown} />
        ) : (
          <TextInput readOnly spellCheck={false} value={shown} />
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        {item.secret ? (
          <Button
            variant="secondary"
            aria-label={t(revealed ? 'setup.item.hideNamed' : 'setup.item.revealNamed', { name })}
            onClick={() => {
              setRevealed(!revealed);
            }}
          >
            {t(revealed ? 'setup.item.hide' : 'setup.item.reveal')}
          </Button>
        ) : null}
        <Button variant="secondary" aria-label={t('setup.item.copyNamed', { name })} onClick={copy}>
          {t('setup.item.copy')}
        </Button>
        <Button
          variant="secondary"
          aria-label={t('setup.item.downloadNamed', { name })}
          onClick={() => {
            saveAsFile(item.fileName, item.content);
          }}
        >
          {t('setup.item.download')}
        </Button>
      </div>
    </div>
  );
}
