// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Ref, useState } from 'react';
import { LoginLink } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { Heading } from '../ui/Heading.tsx';
import { StatePanel } from './StatePanel.tsx';

// What replaces the form when the person cannot sign yet (E18-S02). There is no field to type an address: the address of a
// signature is one that GitHub verified, so the way forward is on GitHub.

/** Where a person adds and verifies an email address. */
const GITHUB_EMAIL_SETTINGS = 'https://github.com/settings/emails';

export interface BlockedPanelProps {
  /** The heading of the panel, for the page to focus when the state changes. */
  readonly headingRef: Ref<HTMLHeadingElement> | undefined;
  /** Asks for the context again; true when the new one is there. */
  readonly reload: () => Promise<boolean>;
  /** The context is being asked for. */
  readonly reloading: boolean;
  /** This page, search included: where a new login ends, so the person comes back to it. */
  readonly returnTo: string;
}

/** "Check again": asks again, and says so when nothing has changed, which a person using a screen reader would not otherwise hear. */
function CheckAgain({ reload, reloading }: Pick<BlockedPanelProps, 'reload' | 'reloading'>) {
  const t = useT();
  const [unchanged, setUnchanged] = useState(false);
  const check = async () => {
    // The answer is in the page again; when it lets the person sign, this panel is gone and there is nothing to say.
    setUnchanged(await reload());
  };
  return (
    <>
      <Button
        variant="primary"
        loading={reloading}
        onClick={() => {
          void check();
        }}
      >
        {t('sign.blocked.check')}
      </Button>
      {unchanged ? <p>{t('sign.blocked.still')}</p> : null}
    </>
  );
}

/** `canSign: false`, `blockedReason: no_verified_email`: GitHub reported no verified address at login. */
export function NoVerifiedEmail({ headingRef, reload, reloading, returnTo }: BlockedPanelProps) {
  const t = useT();
  return (
    <StatePanel tone="warning">
      <Heading level={2} ref={headingRef} focusable>
        {t('sign.blocked.title')}
      </Heading>
      <p>{t('sign.blocked.message')}</p>
      <p>{t('sign.blocked.steps')}</p>
      <div className="flex flex-wrap items-center gap-4">
        <a
          href={GITHUB_EMAIL_SETTINGS}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2"
        >
          {t('sign.blocked.settings')}
        </a>
        <LoginLink look="text" returnTo={returnTo}>
          {t('sign.blocked.relogin')}
        </LoginLink>
      </div>
      <CheckAgain reload={reload} reloading={reloading} />
    </StatePanel>
  );
}

/** `canSign: false` with no reason this page knows: the form is not offered, and asking again is all there is to do. */
export function CannotSign({ headingRef, reload, reloading }: Omit<BlockedPanelProps, 'returnTo'>) {
  const t = useT();
  return (
    <StatePanel tone="warning">
      <Heading level={2} ref={headingRef} focusable>
        {t('sign.cannot.title')}
      </Heading>
      <p>{t('sign.cannot.message')}</p>
      <CheckAgain reload={reload} reloading={reloading} />
    </StatePanel>
  );
}
