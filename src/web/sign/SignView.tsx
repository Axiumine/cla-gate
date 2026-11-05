// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { MarkdownView } from '../components/markdown/MarkdownView.tsx';
import { Timestamp, useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { UserText } from '../ui/UserText.tsx';
import { Confirmation, type Signed } from './Confirmation.tsx';
import { ConsentForm } from './ConsentForm.tsx';
import { Fingerprint } from './Fingerprint.tsx';

export interface SignViewProps {
  readonly context: SignContextResponse;
}

/**
 * The sign page once the context is there (E18-S01): the document name as the page's one `h1`, the version and when it was
 * published, the CLA text in a region a keyboard can scroll, its fingerprint, and the consent form, which the confirmation
 * replaces once the signature is recorded. Every string a person controls (the document name, the repository, the rationale)
 * goes through `UserText`; the CLA text goes through `MarkdownView`, and nothing else sets markup.
 */
export function SignView({ context }: SignViewProps) {
  const t = useT();
  const [signed, setSigned] = useState<Signed | undefined>(undefined);
  const { version } = context;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Heading level={1}>
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
          {context.state === 'resign_required' && version.rationale !== '' ? (
            <>
              <dt className="text-fg-muted">{t('sign.rationale')}</dt>
              <dd>
                <UserText>{version.rationale}</UserText>
              </dd>
            </>
          ) : null}
        </dl>
      </header>
      <article
        aria-label={t('sign.text.label')}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the text scrolls, and a region that scrolls must take focus for a keyboard user (E18-S01)
        tabIndex={0}
        className="max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-surface p-4"
      >
        <MarkdownView source={version.contentMd} />
      </article>
      <Fingerprint sha256={version.contentSha256} />
      {signed === undefined ? (
        <ConsentForm context={context} onSigned={setSigned} />
      ) : (
        <Confirmation signed={signed} prUrl={context.prUrl} />
      )}
    </div>
  );
}
