// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';

/** Only an address on github.com is linked: the context builds it, and this is the second look. */
const GITHUB_PREFIX = 'https://github.com/';

export interface PullRequestLinkProps {
  /** `prUrl` of the context: the pull request the person came from, or `null`. */
  readonly prUrl: string | null;
}

/** The way back to the pull request (E18-S01, E18-S02), drawn only for an `https://github.com/` address. */
export function PullRequestLink({ prUrl }: PullRequestLinkProps) {
  const t = useT();
  return prUrl?.startsWith(GITHUB_PREFIX) === true ? (
    <a href={prUrl} rel="noopener noreferrer" className="underline underline-offset-2">
      {t('sign.done.pullRequest')}
    </a>
  ) : null;
}
