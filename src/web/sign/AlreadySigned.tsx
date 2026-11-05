// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Link } from '@tanstack/react-router';
import { Timestamp, useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import type { NoticeProps } from './notice-props.ts';
import { PullRequestLink } from './PullRequestLink.tsx';
import { StatePanel } from './StatePanel.tsx';

/** `state: already_signed`: which version and when, that nothing is left to do, and the ways on. There is no form. */
export function AlreadySigned({ notice, context, headingRef }: NoticeProps<'signed'>) {
  const t = useT();
  const { signature } = notice;
  return (
    <StatePanel tone="success">
      <Heading level={2} ref={headingRef} focusable>
        {t('sign.signed.title')}
      </Heading>
      {signature === null ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>{t('sign.version')}</dt>
          <dd>
            {signature.major}.{signature.minor}
          </dd>
          <dt>{t('sign.done.signedAt')}</dt>
          <dd>
            <Timestamp value={signature.signedAt} utc />
          </dd>
        </dl>
      )}
      <p>{t('sign.signed.noAction')}</p>
      <div className="flex flex-wrap items-center gap-4">
        <PullRequestLink prUrl={context.prUrl} />
        <Link to="/me/signatures" className="underline underline-offset-2">
          {t('sign.signed.mine')}
        </Link>
      </div>
    </StatePanel>
  );
}
