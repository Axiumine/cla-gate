// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type SyntheticEvent, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Field } from '../ui/Field.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { CorporateFailure } from './CorporateFailure.tsx';
import { useClaim } from './use-claim.ts';

export interface EmployerClaimFormProps {
  /** GitHub's numeric id of the repository the person contributes to. */
  readonly githubRepoId: number;
}

/**
 * The claim of an employee (E21-S04): the box that says the person contributes for an employer, and the button that asks the platform whether
 * an agreement covers them. A success says "Covered by a corporate CLA" and no more: the answer names no company, whether the person had an
 * approval already or got one now. A person nothing covers is told to ask the CLA manager of their employer, in words that name no company,
 * and may try again; a failure of GitHub or a limit is the generic state. Nothing is sent before the box is ticked.
 */
export function EmployerClaimForm({ githubRepoId }: EmployerClaimFormProps) {
  const t = useT();
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const claim = useClaim(githubRepoId);
  if (claim.isSuccess) {
    return (
      <div className="flex flex-col items-start gap-1">
        <StatusMessage tone="success">{t('corporate.claim.done')}</StatusMessage>
        <p className="text-sm text-fg-muted">{t('corporate.claim.doneDetail')}</p>
      </div>
    );
  }
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (confirmed && !claim.isPending) {
      claim.mutate();
    }
  };
  return (
    <form onSubmit={submit} noValidate className="flex w-full max-w-xl flex-col items-start gap-3">
      <Field
        inline
        label={t('corporate.claim.confirm')}
        error={attempted && !confirmed ? t('corporate.claim.confirmRequired') : undefined}
        required
      >
        <Checkbox checked={confirmed} onCheckedChange={setConfirmed} />
      </Field>
      <Button type="submit" variant="primary" loading={claim.isPending}>
        {t('corporate.claim.submit')}
      </Button>
      {claim.isError ? <CorporateFailure error={claim.error} /> : null}
    </form>
  );
}
