// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { RefObject } from 'react';
import { useT } from '../../i18n/index.ts';
import { Button, Heading } from '../../ui/index.ts';
import { type OnSearch, toComparison } from './history-search.ts';

export interface HistoryIntroProps {
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  /** The comparison is open. */
  readonly comparing: boolean;
  readonly onSearch: OnSearch;
}

/** The heading of the list (where focus goes when a panel closes), what the tab is for, and the button that opens the comparison. */
export function HistoryIntro({ headingRef, comparing, onSearch }: HistoryIntroProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-3">
      <Heading level={2} ref={headingRef} focusable>
        {t('history.title')}
      </Heading>
      <p className="max-w-prose text-fg-muted">{t('history.intro')}</p>
      <Button
        aria-expanded={comparing}
        onClick={() => {
          onSearch(toComparison());
        }}
      >
        {t('history.compare')}
      </Button>
    </div>
  );
}
