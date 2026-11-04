// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import type { AppLinks } from './github-links.ts';

export interface NextStepsProps {
  readonly links: AppLinks;
}

/**
 * What the operator does with the credentials (E19-S07): save the three secret files, put the two public values into the
 * `.env` file, restart the stack, then install the App on each organisation through the install link. The link is built from
 * the validated slug (see `appLinks`); when the slug did not pass, the step says to install from the App's page instead and
 * offers no link of its own.
 */
export function NextSteps({ links }: NextStepsProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2">
      <Heading level={2}>{t('setup.next.title')}</Heading>
      <ol className="list-decimal space-y-1 ps-6">
        <li>{t('setup.next.save')}</li>
        <li>{t('setup.next.env')}</li>
        <li>{t('setup.next.restart')}</li>
        <li>
          {t('setup.next.install')}{' '}
          {links.install === undefined ? (
            <span>{t('setup.next.noLink')}</span>
          ) : (
            <a href={links.install} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
              {t('setup.next.installLink')}
            </a>
          )}
        </li>
      </ol>
    </div>
  );
}
