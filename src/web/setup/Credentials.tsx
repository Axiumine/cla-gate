// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useState } from 'react';
import type { z } from 'zod';
import type { convertResponseSchema } from '../../shared/setup.ts';
import { useT } from '../i18n/index.ts';
import { Heading } from '../ui/Heading.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { CredentialItem } from './CredentialItem.tsx';
import { type CredentialItemData, publicItems, secretItems } from './credential-items.ts';
import { appLinks } from './github-links.ts';
import { NextSteps } from './NextSteps.tsx';
import { StepHeading } from './StepHeading.tsx';

export interface CredentialsProps {
  /** What the conversion answered with. The caller keeps it in a mutation result and clears it when the page is left. */
  readonly result: z.infer<typeof convertResponseSchema>;
}

/** A titled group of credentials. */
function Group(props: {
  readonly title: string;
  readonly items: readonly CredentialItemData[];
  readonly announce: (message: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-4">
      <Heading level={2}>{props.title}</Heading>
      {props.items.map((item) => (
        <CredentialItem key={item.label} item={item} announce={props.announce} />
      ))}
    </div>
  );
}

/**
 * The credentials screen (E19-S07): the two public values for the `.env` file and the three secrets with the file each belongs
 * in, a notice that they are shown once, and the next steps. The values are shown from the mutation result and from nowhere
 * else; the page keeps them in no address, router state or storage. Copy results are said in one polite live region.
 */
export function Credentials({ result }: CredentialsProps) {
  const t = useT();
  const [message, setMessage] = useState('');
  const links = appLinks(result);
  return (
    <div className="flex flex-col items-start gap-6">
      <StepHeading focus>{t('setup.credentials.title')}</StepHeading>
      <div
        role="note"
        className="flex flex-col gap-2 rounded-md border border-transparent bg-warning-bg px-3 py-2 text-warning-fg"
      >
        <p className="font-semibold">{t('setup.credentials.once')}</p>
        {links.page === undefined ? null : (
          <a href={links.page} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
            {t('setup.credentials.appPage')}
          </a>
        )}
      </div>
      <Group title={t('setup.credentials.publicTitle')} items={publicItems(result)} announce={setMessage} />
      <Group title={t('setup.credentials.secretTitle')} items={secretItems(result)} announce={setMessage} />
      <StatusMessage>{message}</StatusMessage>
      <NextSteps links={links} />
    </div>
  );
}
