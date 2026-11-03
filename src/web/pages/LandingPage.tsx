// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { LoginLink, useSession } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { QueryBoundary } from '../states/index.ts';
import { Heading } from '../ui/Heading.tsx';

/**
 * The page at `/` (E17-S08), public: what the product is, and "Log in with GitHub" for a visitor who is not logged in. It
 * reads the session to choose between the two; the heading and the sentence do not wait for the answer.
 */
export function LandingPage() {
  const t = useT();
  const session = useSession();
  return (
    <div className="flex flex-col items-start gap-4">
      <Heading level={1}>{t('app.name')}</Heading>
      <p>{t('landing.tagline')}</p>
      <QueryBoundary query={session}>
        {(data) => (data.authenticated ? <p>{t('landing.signedIn')}</p> : <LoginLink>{t('auth.login')}</LoginLink>)}
      </QueryBoundary>
    </div>
  );
}
