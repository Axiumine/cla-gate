// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { OwnSignaturesPage } from '../../shared/own-signatures.ts';
import { useT } from '../i18n/index.ts';
import { Badge } from '../ui/Badge.tsx';
import { UserText } from '../ui/UserText.tsx';

export type Item = OwnSignaturesPage['items'][number];

/** The org of a signature: its account login (the snapshot GitHub gave) as text, and a badge while the App is suspended there. */
export function Organisation({ item }: { readonly item: Item }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <UserText>{item.installation.accountLogin}</UserText>
      {item.installation.suspended ? <Badge status="suspended" /> : null}
    </span>
  );
}

/** Where the person signed from: the repository and, when they came from a pull request, its number. */
export function Source({ item }: { readonly item: Item }) {
  const t = useT();
  const { source } = item;
  if (source === null) {
    return <span className="text-fg-muted">{t('me.signatures.source.none')}</span>;
  }
  return (
    <span className="flex flex-col">
      <UserText>{source.repositoryFullName}</UserText>
      {source.prNumber === null ? null : <span>{t('me.signatures.source.pr', { number: source.prNumber })}</span>}
    </span>
  );
}
