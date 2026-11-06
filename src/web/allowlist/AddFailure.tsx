// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { Button } from '../ui/index.ts';
import { addRuleOf } from './allowlist-rules.ts';

export interface AddFailureProps {
  /** Why the add failed, when it did and the login field does not show it. */
  readonly error: unknown;
  /** Sends the same entry again. */
  readonly retry: () => void;
  /** The entry is being sent: the retry is busy. */
  readonly retrying: boolean;
}

/**
 * A failed add that is about the entry as a whole (E18-S06). `allowlist_entry_exists` and `no_organization` are told in the catalog's
 * words as an alert; `members_permission_missing` says how to accept the updated permissions of the App on the organisation's
 * installation page, with "Try again". Anything else (GitHub down or limiting, a `403`) goes through the error state, with the
 * countdown for a limit; the typed values stay.
 */
export function AddFailure({ error, retry, retrying }: AddFailureProps) {
  const t = useT();
  if (error === undefined) {
    return null;
  }
  const rule = addRuleOf(error);
  if (rule === undefined) {
    return <ErrorState variant="banner" error={error} refetch={retry} retrying={retrying} />;
  }
  return (
    <div role="alert" className="flex flex-col items-start gap-2 text-sm text-danger-fg">
      <p>{t(`allowlist.rule.${rule}`)}</p>
      {rule === 'members_permission_missing' ? (
        <Button variant="primary" loading={retrying} onClick={retry}>
          {t('states.retry')}
        </Button>
      ) : null}
    </div>
  );
}
