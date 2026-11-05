// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useRef } from 'react';
import type { SignResponse } from '../../shared/sign.ts';
import { Timestamp, useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { UserText } from '../ui/UserText.tsx';

/** What the confirmation is about: the answer of the server and the name that was sent. */
export interface Signed {
  readonly response: SignResponse;
  /** The typed name, as the shared schema cleaned it and as it was sent. */
  readonly name: string;
}

export interface ConfirmationProps {
  readonly signed: Signed;
  /** `prUrl` of the context: the pull request the person came from, or `null`. */
  readonly prUrl: string | null;
}

/** Only an address on github.com is linked: the context builds it, and this is the second look. */
const GITHUB_PREFIX = 'https://github.com/';

/**
 * What replaces the form once the signature is recorded (E18-S01): a heading that takes focus, when and which version, the
 * name that was typed (as text), the way back to the pull request when there is one, and what happens next. When the server
 * answered that the same major version was already signed (another tab), it says so, because the signature that stands is
 * the earlier one and the name typed here was not stored.
 */
export function Confirmation({ signed, prUrl }: ConfirmationProps) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const { signature, created } = signed.response;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <Heading level={2} ref={heading} focusable>
        {t('sign.done.title')}
      </Heading>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-fg-muted">{t('sign.done.signedAt')}</dt>
        <dd>
          <Timestamp value={signature.signedAt} utc />
        </dd>
        <dt className="text-fg-muted">{t('sign.version')}</dt>
        <dd>
          {signature.major}.{signature.minor}
        </dd>
        <dt className="text-fg-muted">{t('sign.done.name')}</dt>
        <dd>
          <UserText>{signed.name}</UserText>
        </dd>
      </dl>
      {created ? null : <p>{t('sign.done.existing')}</p>}
      {prUrl?.startsWith(GITHUB_PREFIX) === true ? (
        <a href={prUrl} rel="noopener noreferrer" className="underline underline-offset-2">
          {t('sign.done.pullRequest')}
        </a>
      ) : null}
      <p>{t('sign.done.update')}</p>
    </section>
  );
}
