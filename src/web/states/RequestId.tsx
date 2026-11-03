// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';

/** What the person is told after pressing the button: the catalog key of the result, or nothing before the first press. */
type Outcome = 'states.copied' | 'states.copyFailed' | null;

/** Puts `text` on the clipboard. A browser without the Clipboard API (an insecure page) or a refusal is `false`, not a crash. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export interface RequestIdProps {
  /** The id to show; the caller checked that it looks like one of the server's (`visibleRequestId`). */
  readonly id: string;
}

/**
 * The request id of a failed request, in `<code>`, with a button that copies it (E17-S07): it is what support asks for. The
 * result of the copy is said in a polite live region that stays in the page, so a screen reader reads it.
 */
export function RequestId({ id }: RequestIdProps) {
  const t = useT();
  const [outcome, setOutcome] = useState<Outcome>(null);
  const copy = () => {
    void copyToClipboard(id).then((copied) => {
      setOutcome(copied ? 'states.copied' : 'states.copyFailed');
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span>{t('states.requestId')}</span>
      <code className="break-all rounded-md bg-surface-muted px-1 font-code text-fg">{id}</code>
      <Button variant="ghost" onClick={copy}>
        {t('states.copyRequestId')}
      </Button>
      <StatusMessage>{outcome === null ? null : t(outcome)}</StatusMessage>
    </div>
  );
}
