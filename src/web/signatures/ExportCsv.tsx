// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useId } from 'react';
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { Button } from '../ui/Button.tsx';
import { BASE_CLASSES, VARIANT_CLASSES } from '../ui/button-styles.ts';
import { classNames } from '../ui/class-names.ts';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { csvLinkOf } from './csv-link.ts';
import type { StateFilter } from './signature-filters.ts';
import { useCsvExport } from './use-csv-export.ts';

interface ExportLinkProps {
  readonly installationId: number;
  readonly documentId: number;
  readonly state: StateFilter | undefined;
}

/**
 * The link that downloads the file (E18-S07): it points at the export of the document with the status and nothing else, so it can be
 * copied, opened in another tab and followed by a browser that has no script. A plain click does the same through `useCsvExport`, which
 * is how a refusal (a `429` with its countdown) can be shown on the page.
 */
function ExportLink({ installationId, documentId, state }: ExportLinkProps) {
  const t = useT();
  const address = csvLinkOf(installationId, documentId, state);
  const { download, pending, savedAs, refusal } = useCsvExport(address, documentId);
  return (
    <>
      <a
        href={address}
        aria-busy={pending ? true : undefined}
        className={classNames(BASE_CLASSES, VARIANT_CLASSES.secondary)}
        onClick={(event) => {
          event.preventDefault();
          download();
        }}
      >
        {t('signatures.export')}
      </a>
      {refusal === undefined ? null : (
        <ErrorState error={refusal.error} variant="banner" refetch={download} retrying={pending} />
      )}
      <StatusMessage tone={savedAs === undefined ? 'neutral' : 'success'}>
        {savedAs === undefined ? null : t('signatures.export.done', { name: savedAs })}
      </StatusMessage>
    </>
  );
}

export interface ExportCsvProps {
  /** `installations.id` of the tenant in the address. */
  readonly installationId: number;
  /** The document chosen in the filter, or `undefined` while none is: the export is per document. */
  readonly documentId: number | undefined;
  /** The status chosen in the filter: the one filter the export takes. */
  readonly state: StateFilter | undefined;
}

/**
 * "Export CSV" (E18-S07): the signatures of the chosen document, as the file of E16-S03. It is enabled once a document is chosen and
 * carries the status filter only; the search is not part of it, and the help says so. A notice says that the file holds
 * personal data. While no document is chosen the button is off and says what is needed.
 */
export function ExportCsv({ installationId, documentId, state }: ExportCsvProps) {
  const t = useT();
  const hint = useId();
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="max-w-prose text-fg-muted">{t('signatures.export.help')}</p>
      <p className="max-w-prose text-fg-muted">{t('signatures.export.notice')}</p>
      {documentId === undefined ? (
        <>
          <Button disabled aria-describedby={hint}>
            {t('signatures.export')}
          </Button>
          <p id={hint} className="text-sm text-fg-muted">
            {t('signatures.export.choose')}
          </p>
        </>
      ) : (
        <ExportLink
          key={`${String(documentId)}-${state ?? 'all'}`}
          installationId={installationId}
          documentId={documentId}
          state={state}
        />
      )}
    </div>
  );
}
