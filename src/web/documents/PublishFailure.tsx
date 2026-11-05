// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useFormatters, useT } from '../i18n/index.ts';
import { ErrorState } from '../states/ErrorState.tsx';
import { ruleMessage } from './document-rules.ts';

export interface PublishFailureProps {
  /** Why the request failed: a rule of the documents API that has words here, or anything else. */
  readonly error: unknown;
}

/**
 * A failed publish or save that the person can read about (E18-S05): a rule the server broke (`content_unchanged`, a `content_`
 * rule, `first_version_must_be_major`, `version_conflict`) in the words of the catalog, as an alert; anything else (a `403`, a
 * network failure) through the general error state. The typed text and the choices stay where they were.
 */
export function PublishFailure({ error }: PublishFailureProps) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const message = ruleMessage({ t, formatNumber }, error);
  return message === undefined ? (
    <ErrorState variant="banner" error={error} />
  ) : (
    <p role="alert" className="text-sm text-danger-fg">
      {message}
    </p>
  );
}
