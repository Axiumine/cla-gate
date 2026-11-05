// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { LoginLink } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { StatePanel } from './StatePanel.tsx';

export interface LoginPromptProps {
  /** The sign page itself, search included: where the login ends, so the person comes back to the same page. */
  readonly returnTo: string;
}

/**
 * What the sign page is for someone who is not logged in (E18-S02): the context endpoint answered `401`, so no text of the
 * CLA has been loaded, and the page explains what signing involves and offers "Log in with GitHub". It is the page's one `h1`.
 * The login starts by a full-page navigation, and ends on `returnTo`, which loads the page again with the same search.
 */
export function LoginPrompt({ returnTo }: LoginPromptProps) {
  const t = useT();
  return (
    <StatePanel tone="neutral">
      <Heading level={1}>{t('sign.login.title')}</Heading>
      <p>{t('sign.login.intro')}</p>
      <ol className="flex list-decimal flex-col gap-1 pl-6">
        <li>{t('sign.login.step.account')}</li>
        <li>{t('sign.login.step.read')}</li>
        <li>{t('sign.login.step.visible')}</li>
      </ol>
      <p>{t('sign.login.after')}</p>
      <LoginLink returnTo={returnTo}>{t('auth.login')}</LoginLink>
    </StatePanel>
  );
}
