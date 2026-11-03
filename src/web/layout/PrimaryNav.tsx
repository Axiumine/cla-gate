// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { classNames } from '../ui/class-names.ts';
import { NAV_ITEMS } from './nav-items.ts';

/**
 * The main navigation (E17-S09), a `<nav>` landmark named by the catalog. From 768 px (Tailwind's `md`) the links are laid out
 * in a row; below it they collapse behind a disclosure button that carries `aria-expanded` and `aria-controls`. Escape closes
 * the list and gives focus back to the button, and choosing a link closes it. The current page's link has
 * `aria-current="page"`, which the router sets on the link that matches the location.
 */
export function PrimaryNav() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  // Escape is heard on the controls themselves (the button and the links), which is where focus is when it is pressed.
  const closeOnEscape = (event: KeyboardEvent) => {
    if (open && event.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
    }
  };
  return (
    <nav aria-label={t('nav.label')}>
      <Button
        ref={button}
        variant="secondary"
        className="md:hidden"
        aria-expanded={open}
        aria-controls={listId}
        onKeyDown={closeOnEscape}
        onClick={() => {
          setOpen(!open);
        }}
      >
        {t('nav.menu')}
      </Button>
      <ul
        id={listId}
        className={classNames(open ? 'flex' : 'hidden', 'mt-2 flex-col gap-2 md:mt-0 md:flex md:flex-row')}
      >
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              activeOptions={{ exact: true }}
              className="underline-offset-2 hover:underline aria-[current=page]:font-semibold"
              onKeyDown={closeOnEscape}
              onClick={() => {
                setOpen(false);
              }}
            >
              {t(item.label)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
