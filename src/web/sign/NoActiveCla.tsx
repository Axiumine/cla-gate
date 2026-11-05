// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { StatePanel } from './StatePanel.tsx';
import { useFocusOnMount } from './use-focus.ts';

export interface NoActiveClaProps {
  /** The state replaced a page the person was working on (the CLA was withdrawn while they signed): its heading takes focus. */
  readonly replacedPage: boolean;
}

/**
 * The repository has no CLA in force (E18-S02): no document is attached, or none has a published version. It is a neutral
 * message with no form and no text, and it is the page's one `h1`. It says nothing about the tenant.
 */
export function NoActiveCla({ replacedPage }: NoActiveClaProps) {
  const t = useT();
  const heading = useFocusOnMount<HTMLHeadingElement>(replacedPage);
  return (
    <StatePanel tone="neutral">
      <Heading level={1} ref={heading} focusable>
        {t('sign.noCla.title')}
      </Heading>
      <p>{t('sign.noCla.message')}</p>
    </StatePanel>
  );
}
