// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useLocation } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { useAuthState, useSession } from './hooks.ts';
import { LoginLink } from './LoginLink.tsx';
import { returnPathOf } from './return-to.ts';

/**
 * "Your session ended" with a link to log in again (E17-S08), shown when a call came back 401 while a session was held. It
 * does not block: the page below keeps what it shows and what the person was typing, and the link returns to the page they
 * are on. The live region is always in the page and only its content comes and goes, which is what makes a screen reader
 * announce it. It goes away if the session is seen again (the person logged in from another tab).
 */
export function SessionEndedBanner() {
  const t = useT();
  const { ended } = useAuthState();
  const session = useSession().data;
  const location = useLocation();
  const visible = ended && session?.authenticated !== true;
  return (
    <div role="status">
      {visible ? (
        <div className="flex flex-wrap items-center gap-3 bg-warning-bg px-4 py-2 text-warning-fg">
          <p>{t('auth.sessionEnded')}</p>
          <LoginLink look="text" returnTo={returnPathOf(location.pathname, location.searchStr)}>
            {t('auth.login')}
          </LoginLink>
        </div>
      ) : null}
    </div>
  );
}
