// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Timestamp, useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import type { NoticeProps } from './notice-props.ts';
import { StatePanel } from './StatePanel.tsx';

/** `state: ready` after a revocation: a revocation reaches forward only, and signing again covers the person again. */
export function RevokedNotice({ notice, headingRef }: NoticeProps<'revoked'>) {
  const t = useT();
  return (
    <StatePanel tone="info">
      <Heading level={2} ref={headingRef} focusable>
        {t('sign.revoked.title')}
      </Heading>
      <p>{t('sign.revoked.message')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt>{t('sign.revoked.on')}</dt>
        <dd>
          <Timestamp value={notice.revokedAt} utc />
        </dd>
      </dl>
    </StatePanel>
  );
}
