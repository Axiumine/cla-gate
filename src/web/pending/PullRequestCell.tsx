// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { visibleText } from '../ui/user-text.ts';
import type { PendingPr } from './pending-queries.ts';
import { pullRequestUrl } from './repository-pattern.ts';

/**
 * The pull request of a row (E18-S08): its number, linked to the pull request on GitHub only when the repository's name has the shape
 * of one (`pullRequestUrl`), and plain text otherwise. The link leaves the page with `noopener` and no referrer.
 */
export function PullRequestCell({ item }: { readonly item: PendingPr }) {
  const t = useT();
  const { repository, prNumber } = item;
  const url = pullRequestUrl(repository.fullName, prNumber);
  const label = t('pending.pr', { number: prNumber });
  return url === undefined ? (
    <span>{label}</span>
  ) : (
    <a
      href={url}
      rel="noopener noreferrer"
      aria-label={t('pending.pr.link', { number: prNumber, repository: visibleText(repository.fullName) })}
      className="underline underline-offset-2"
    >
      {label}
    </a>
  );
}
