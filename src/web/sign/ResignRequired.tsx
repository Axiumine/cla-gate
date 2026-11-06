// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { UserText } from '../ui/UserText.tsx';
import type { NoticeProps } from './notice-props.ts';
import { StatePanel } from './StatePanel.tsx';

/** `state: resign_required`: the major version the person signed, the version now in force, and what changed in it. */
export function ResignRequired({ notice, context, headingRef }: NoticeProps<'resign'>) {
  const t = useT();
  const { version } = context;
  const current = `${version.major}.${version.minor}`;
  return (
    <StatePanel tone="info">
      <Heading level={2} ref={headingRef} focusable>
        {t('sign.resign.title')}
      </Heading>
      <p>
        {notice.signature === null
          ? t('sign.resign.messageNew', { current })
          : t('sign.resign.message', { signed: notice.signature.major, current })}
      </p>
      {version.rationale === '' ? null : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>{t('sign.rationale')}</dt>
          <dd>
            <UserText>{version.rationale}</UserText>
          </dd>
        </dl>
      )}
    </StatePanel>
  );
}
