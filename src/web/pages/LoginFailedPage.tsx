// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import type { LoginFailureReason } from '../../shared/auth.ts';
import { LoginLink } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';

export interface LoginFailedPageProps {
  /** The reason the login callback gave, when it is one of the known codes; anything else is `undefined`. */
  readonly reason: LoginFailureReason | undefined;
}

/**
 * The page at `/login/failed` (E17-S08), public: where the login callback sends a visitor whose login did not finish. The
 * words come from the catalog by the reason code, and a missing or unknown reason gets the generic ones: the value of the
 * query is never put on the screen. "Try again" starts the login over by a full-page navigation, and a link goes home.
 */
export function LoginFailedPage({ reason }: LoginFailedPageProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-4">
      <Heading level={1}>{t('login.failed.title')}</Heading>
      <p>{reason === undefined ? t('login.failed.generic') : t(`login.failed.${reason}`)}</p>
      <div className="flex flex-wrap items-center gap-3">
        <LoginLink>{t('login.failed.retry')}</LoginLink>
        <Link to="/" className="underline underline-offset-2">
          {t('login.failed.home')}
        </Link>
      </div>
    </div>
  );
}
