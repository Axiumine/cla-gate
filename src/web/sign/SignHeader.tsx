// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Ref } from 'react';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { Timestamp, useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { UserText } from '../ui/UserText.tsx';

export interface SignHeaderProps {
  readonly context: SignContextResponse;
  /** The `h1`, which takes focus when the person has reviewed a new version. */
  readonly titleRef: Ref<HTMLHeadingElement>;
}

/** The document name as the page's one `h1`, with the repository, the version and when it was published (E18-S01). */
export function SignHeader({ context, titleRef }: SignHeaderProps) {
  const t = useT();
  const { version } = context;
  return (
    <header className="flex flex-col gap-3">
      <Heading level={1} ref={titleRef} focusable>
        <UserText>{context.document.name}</UserText>
      </Heading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-fg-muted">{t('sign.repository')}</dt>
        <dd>
          <UserText>{context.repository.fullName}</UserText>
        </dd>
        <dt className="text-fg-muted">{t('sign.version')}</dt>
        <dd>
          {version.major}.{version.minor}
        </dd>
        <dt className="text-fg-muted">{t('sign.published')}</dt>
        <dd>
          <Timestamp value={version.publishedAt} utc />
        </dd>
      </dl>
    </header>
  );
}
