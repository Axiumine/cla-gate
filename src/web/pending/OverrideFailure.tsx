// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { overrideRuleOf } from './override-rules.ts';

export interface OverrideFailureProps {
  /** Why the record or the removal failed, when it did and no field shows it. */
  readonly error: unknown;
  /** Sends the same request again. */
  readonly retry: () => void;
  /** The request is being sent: the retry is busy. */
  readonly retrying: boolean;
}

/**
 * A failed record or removal of an override that is about the commit or the repository as a whole (E18-S08): `commit_not_found`, `override_exists`,
 * `repository_disabled` and `installation_suspended` are told in the catalog's words as an alert. Anything else (GitHub down, `502`,
 * or limiting, `503`, with the countdown for the limit; a `403`) goes through the error state, with "Try again" where asking again can
 * help. The typed reason stays.
 */
export function OverrideFailure({ error, retry, retrying }: OverrideFailureProps) {
  const t = useT();
  if (error === undefined) {
    return null;
  }
  const rule = overrideRuleOf(error);
  if (rule === undefined) {
    return <ErrorState variant="banner" error={error} refetch={retry} retrying={retrying} />;
  }
  return (
    <p role="alert" className="text-sm text-danger-fg">
      {t(`pending.rule.${rule}`)}
    </p>
  );
}
