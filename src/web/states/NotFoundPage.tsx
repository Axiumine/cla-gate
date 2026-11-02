// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';

/** The `notFoundComponent` of the router (E17-S07): a 404 page with a link home. It is the page's `h1`, and public. */
export function NotFoundPage() {
  const t = useT();
  return (
    <div className="flex flex-col items-start gap-3 p-6">
      <Heading level={1}>{t('states.notFound.title')}</Heading>
      <p>{t('states.notFound.message')}</p>
      <Link to="/" className="underline underline-offset-2">
        {t('states.notFound.home')}
      </Link>
    </div>
  );
}
