// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { ErrorState } from '../states/index.ts';
import { Button } from '../ui/Button.tsx';
import { corporateErrorKey, isReloadable } from './corporate-errors.ts';

export interface CorporateFailureProps {
  readonly error: unknown;
  /** Loads the current text of the corporate CLA: offered where the text has moved on. */
  readonly onReload: () => void;
}

/** The failure of a corporate request (E21-S02): the words of the corporate codes, with a way to load the current text, or the generic state. */
export function CorporateFailure({ error, onReload }: CorporateFailureProps) {
  const t = useT();
  const key = corporateErrorKey(error);
  if (key === null) {
    return <ErrorState variant="banner" error={error} />;
  }
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-md border border-transparent bg-danger-bg px-3 py-2 text-danger-fg"
    >
      <p>{t(key)}</p>
      {isReloadable(error) ? <Button onClick={onReload}>{t('corporate.sign.reload')}</Button> : null}
    </div>
  );
}
