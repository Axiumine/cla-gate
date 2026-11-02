// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { ErrorState } from './ErrorState.tsx';
import { reloadPage } from './reload-page.ts';

export interface CrashFallbackProps {
  /** What was thrown: an `ApiError` shows its request id, a 403 the forbidden state, anything else the generic message. */
  readonly error: unknown;
}

/** What the root boundary and the router's `errorComponent` show (E17-S07): the error state with a "Reload" button, as the page's own `h1`. */
export function CrashFallback({ error }: CrashFallbackProps) {
  const t = useT();
  return (
    <ErrorState error={error} level={1}>
      <Button variant="primary" onClick={reloadPage}>
        {t('states.crash.reload')}
      </Button>
    </ErrorState>
  );
}
