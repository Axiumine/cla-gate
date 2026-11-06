// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { type RepositoryRule, repositoryRuleOf } from './repository-rules.ts';

export interface RepositoryFailureProps {
  /** Why the attach, the enable or the disable failed. */
  readonly error: unknown;
  /** Sends the same request again. */
  readonly retry: () => void;
  /** The request is being sent: the retry is busy. */
  readonly retrying: boolean;
  /** What helps with a rule once it is told (a link, a button): not drawn for any other failure. */
  readonly fix?: (rule: RepositoryRule) => ReactNode;
}

/**
 * A failed attach, enable or disable (E18-S10). `document_not_attachable`, `document_unpublished`, `repository_enabled`,
 * `no_active_cla` and `installation_suspended` are told in the catalog's words as an alert, with the `fix` that goes with them.
 * Anything else (GitHub down, `502`, or limiting, `503`, with the countdown for the limit; a `403`, which is the forbidden state with
 * no retry) goes through the error state, with "Try again" where asking again can help.
 */
export function RepositoryFailure({ error, retry, retrying, fix }: RepositoryFailureProps) {
  const t = useT();
  const rule = repositoryRuleOf(error);
  if (rule === undefined) {
    return <ErrorState variant="banner" error={error} refetch={retry} retrying={retrying} />;
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <p role="alert" className="text-sm text-danger-fg">
        {t(`repositories.rule.${rule}`)}
      </p>
      {fix?.(rule)}
    </div>
  );
}
