// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { ErrorState } from '../../states/ErrorState.tsx';

export interface EraseFailureProps {
  /** `409 count_changed`: the preview was read again and the new numbers need a confirmation of their own. */
  readonly countChanged: boolean;
  /** Any other failure of the request: a `403`, GitHub or the database down. `404` is not one: the preview says the installation holds nothing. */
  readonly failure: unknown;
}

/**
 * How the last attempt to erase failed (E18-S14), in the question and above its buttons, as an alert so that it is announced the moment it
 * comes in. A changed count has a sentence of its own, in the warning colours of the re-signing notice of the editor; any other failure is
 * the error banner with its request id. Nothing shows while there is no failure.
 */
export function EraseFailure({ countChanged, failure }: EraseFailureProps) {
  const t = useT();
  if (countChanged) {
    return (
      <p role="alert" className="rounded-md border border-transparent bg-warning-bg px-3 py-2 text-warning-fg">
        {t('erase.countChanged')}
      </p>
    );
  }
  return failure === undefined ? null : <ErrorState variant="banner" error={failure} />;
}
