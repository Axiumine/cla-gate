// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { Heading } from '../ui/Heading.tsx';
import { useFocusOnMount } from './use-focus.ts';

export interface StaleBannerProps {
  /** Asks for the context again and shows it. */
  readonly onReview: () => void;
  /** The context is being asked for. */
  readonly reviewing: boolean;
}

/**
 * "The CLA changed while you were reading" (E18-S02): the server refused the signature because the version or the consent
 * sentence on screen is no longer the one in force (`409 stale_version` or `stale_consent`). Nothing was recorded. The banner is
 * an alert, its heading takes focus, and "Review the new version" loads the version in force.
 */
export function StaleBanner({ onReview, reviewing }: StaleBannerProps) {
  const t = useT();
  const heading = useFocusOnMount<HTMLHeadingElement>();
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-md border border-transparent bg-warning-bg px-3 py-2 text-warning-fg"
    >
      <Heading level={3} ref={heading} focusable>
        {t('sign.stale.title')}
      </Heading>
      <p>{t('sign.stale.message')}</p>
      <Button variant="primary" loading={reviewing} onClick={onReview}>
        {t('sign.stale.review')}
      </Button>
    </div>
  );
}
