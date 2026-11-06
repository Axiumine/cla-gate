// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { ErrorState } from '../../states/ErrorState.tsx';

export interface InvalidateFailureProps {
  readonly major: number;
  /** `409 count_changed`: the preview was read again and the new number needs a confirmation of its own. */
  readonly countChanged: boolean;
  /** `409 nothing_to_invalidate`: nothing of the major is in force any more. */
  readonly nothing: boolean;
  /** Any other failure of the request: a `403`, the uniform `404`, GitHub or the queue down. */
  readonly failure: unknown;
}

/** The look of a rule the question tells in a sentence of its own: the warning colours of the re-signing notice of the editor. */
const RULE_CLASSES = 'rounded-md border border-transparent bg-warning-bg px-3 py-2 text-warning-fg';

/**
 * How the last attempt to invalidate failed (E18-S14), in the question and above its buttons, as an alert so that it is announced the moment
 * it comes in. The two rules of the invalidation have sentences of their own; any other failure is the error banner with its request id.
 * Nothing shows while there is no failure.
 */
export function InvalidateFailure({ major, countChanged, nothing, failure }: InvalidateFailureProps) {
  const t = useT();
  if (countChanged) {
    return (
      <p role="alert" className={RULE_CLASSES}>
        {t('invalidate.countChanged')}
      </p>
    );
  }
  if (nothing) {
    return (
      <p role="alert" className={RULE_CLASSES}>
        {t('invalidate.gone', { major })}
      </p>
    );
  }
  return failure === undefined ? null : <ErrorState variant="banner" error={failure} />;
}
