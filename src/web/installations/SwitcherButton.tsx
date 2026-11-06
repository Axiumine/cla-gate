// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Ref } from 'react';
import type { InstallationSummary } from '../../shared/installations.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { UserText } from '../ui/UserText.tsx';

export interface SwitcherButtonProps {
  readonly buttonRef: Ref<HTMLButtonElement>;
  readonly open: boolean;
  /** The id of the list the button opens; only named while the list is there. */
  readonly listId: string;
  /** The installation on screen, if the list holds it. */
  readonly current: InstallationSummary | undefined;
  readonly onToggle: () => void;
}

/** The disclosure button of the switcher: "Installation" and, when it is known, the account on screen (cut at 24 characters, whole for a screen reader). */
export function SwitcherButton({ buttonRef, open, listId, current, onToggle }: SwitcherButtonProps) {
  const t = useT();
  return (
    <Button
      ref={buttonRef}
      variant="secondary"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      onClick={onToggle}
    >
      {t('tenant.switcher.button')}
      {current === undefined ? null : (
        <>
          {': '}
          <UserText maxLength={24}>{current.accountLogin}</UserText>
        </>
      )}
    </Button>
  );
}
