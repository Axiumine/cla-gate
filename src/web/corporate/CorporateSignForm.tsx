// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { type SyntheticEvent, useState } from 'react';
import type { CorporateDocumentResponse } from '../../shared/corporate.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { CorporateFailure } from './CorporateFailure.tsx';
import { EMPTY, type Entries, isComplete } from './entries.ts';
import { SignEntries } from './SignEntries.tsx';
import { useSigning } from './use-signing.ts';

export interface CorporateSignFormProps {
  /** The corporate CLA in force, whose version and hash the request names. */
  readonly document: CorporateDocumentResponse;
  /** Loads the text again: what a person does when the version moved on while they read. */
  readonly onReload: () => void;
}

/** What replaces the form once the agreement is signed: the news, and the way to the list. */
function Signed() {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-3">
      <StatusMessage tone="success">{t('corporate.sign.done')}</StatusMessage>
      <Link to="/corporate/agreements" className="underline underline-offset-2">
        {t('corporate.sign.doneLink')}
      </Link>
    </div>
  );
}

/**
 * The form of the corporate agreement (E21-S02): the company, the title of the signatory, the name they type and the box that says
 * they may bind the company. The request names the version and the hash of the text on screen, so the server signs that text and
 * no other. Nothing the person typed is kept after a success, and nothing of it is put in an address.
 */
export function CorporateSignForm({ document, onReload }: CorporateSignFormProps) {
  const t = useT();
  const [entries, setEntries] = useState<Entries>(EMPTY);
  const [attempted, setAttempted] = useState(false);
  const sign = useSigning(document, () => {
    setEntries(EMPTY);
  });
  if (sign.isSuccess) {
    return <Signed />;
  }
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (isComplete(entries) && !sign.isPending) {
      sign.mutate(entries);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="flex w-full max-w-xl flex-col items-start gap-4">
      <SignEntries
        entries={entries}
        attempted={attempted}
        onChange={(part) => {
          setEntries((current) => ({ ...current, ...part }));
        }}
      />
      <p className="text-sm text-fg-muted">{document.consent.text}</p>
      <Button type="submit" variant="primary" loading={sign.isPending}>
        {t('corporate.sign.submit')}
      </Button>
      {sign.isError ? <CorporateFailure error={sign.error} onReload={onReload} /> : null}
    </form>
  );
}
