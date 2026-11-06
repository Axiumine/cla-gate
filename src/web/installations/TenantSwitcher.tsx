// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useRouterState } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { installationIdOf } from './installation-params.ts';
import { SwitcherButton } from './SwitcherButton.tsx';
import { SwitcherList } from './SwitcherList.tsx';
import { type Dismissal, useDismiss } from './use-dismiss.ts';
import { useInstallations } from './use-installations.ts';

/**
 * The tenant switcher in the header of the shell (E18-S04): a disclosure button that names the installation on screen and, open,
 * lists the installations of the person as links. Choosing one goes to the same screen of that installation when it has it, else
 * to the start of that installation. The button carries `aria-expanded` and `aria-controls`; Escape closes the list and gives
 * focus back to the button, choosing a link closes it, and so does moving focus or the pointer out of the switcher. The list is the one of
 * `GET /api/installations`, so it holds only what the server says the person administers.
 */
export function TenantSwitcher() {
  const t = useT();
  const installations = useInstallations().data;
  // The shell renders this above the route boundaries, where there is no nearest match for `useParams`: the state is read instead.
  // type-coverage:ignore-next-line -- the router state type is made from the route tree, which holds any
  const active = useRouterState({ select: (state) => installationIdOf(state.matches.at(-1)?.params) });
  // type-coverage:ignore-next-line -- the router state type is made from the route tree, which holds any
  const here = useRouterState({ select: (state) => state.matches.at(-1)?.fullPath });
  const [open, setOpen] = useState(false);
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const frame = useRef<HTMLElement>(null);
  useDismiss(frame, open, (how: Dismissal) => {
    setOpen(false);
    if (how === 'escape') {
      button.current?.focus();
    }
  });
  if (installations === undefined || installations.length === 0) {
    return null;
  }
  const current = installations.find((installation) => installation.id === active);
  return (
    <nav ref={frame} aria-label={t('tenant.switcher.label')} className="relative">
      <SwitcherButton
        buttonRef={button}
        open={open}
        listId={listId}
        current={current}
        onToggle={() => {
          setOpen(!open);
        }}
      />
      {open ? (
        <SwitcherList
          id={listId}
          installations={installations}
          active={active}
          here={here}
          onChoose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </nav>
  );
}
