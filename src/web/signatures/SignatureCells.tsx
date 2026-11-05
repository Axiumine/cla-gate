// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { UserText } from '../ui/UserText.tsx';
import type { Signature } from './signature-queries.ts';

/**
 * The signer of a row (E18-S07): the name they typed and their login, both text a person controls and drawn through `UserText`. Once
 * the personal data was erased the cell says so and shows nothing else: the numeric GitHub id has a column of its own.
 */
export function SignerCell({ item }: { readonly item: Signature }) {
  const t = useT();
  const { signer } = item;
  if (signer === null) {
    return <span className="text-fg-muted">{t('signatures.signer.erased')}</span>;
  }
  return (
    <span className="flex flex-col">
      <UserText>{signer.name}</UserText>
      <span className="text-fg-muted">
        <UserText>{signer.login}</UserText>
      </span>
    </span>
  );
}

/** Where the person signed from: the repository and, when they came from a pull request, its number. */
export function SourceCell({ item }: { readonly item: Signature }) {
  const t = useT();
  const { source } = item;
  if (source === null) {
    return <span className="text-fg-muted">{t('signatures.source.none')}</span>;
  }
  return (
    <span className="flex flex-col">
      <UserText>{source.repositoryFullName}</UserText>
      {source.prNumber === null ? null : <span>{t('signatures.source.pr', { number: source.prNumber })}</span>}
    </span>
  );
}

/** The numeric GitHub id, which is the identity of a signer and what a search by id matches: in `<code>`. */
export function GithubIdCell({ item }: { readonly item: Signature }) {
  return <code>{item.githubUserId}</code>;
}
