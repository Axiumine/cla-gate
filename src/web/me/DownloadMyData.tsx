// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/index.ts';
import { Button } from '../ui/Button.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { useDataExport } from './use-data-export.ts';

/**
 * "Download my data" (E18-S03): everything the instance holds about the person as one JSON file (E16-S06), from the same origin
 * with the session cookie. A refusal, a `429` included, is the error state with its request ID and, after a `429`, the
 * countdown of "Try again". The result is announced in a polite live region, which is in the page before its text changes.
 */
export function DownloadMyData() {
  const t = useT();
  const { download, pending, savedAs, refusal } = useDataExport();
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-fg-muted">{t('me.download.help')}</p>
      <Button loading={pending} onClick={download}>
        {t('me.download.button')}
      </Button>
      {refusal === undefined ? null : (
        <ErrorState error={refusal.error} variant="banner" refetch={download} retrying={pending} />
      )}
      <StatusMessage tone={savedAs === undefined ? 'neutral' : 'success'}>
        {savedAs === undefined ? null : t('me.download.done', { name: savedAs })}
      </StatusMessage>
    </div>
  );
}
