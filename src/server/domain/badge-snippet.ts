// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { PUBLIC_BADGE_PATH } from '../../shared/public-verification.ts';
import { repositorySignUrl } from '../../shared/sign-link.ts';

// The snippet a maintainer pastes into a README (E22-S03): the project badge, linked to the sign page of the repository. Built from
// the configured public address and the repository's GitHub id alone, so it holds no name, no login and nothing a person typed. Both
// parts of the address are shapes that need no escaping in Markdown or in an HTML attribute: an origin whose host is letters, digits,
// hyphens and dots (or an IPv6 literal), and a path of fixed words and one number.

/** The text a screen reader says for the image, and a browser shows while it loads. */
const ALT = 'CLA: required';

/** What the snippet comes to: the same badge and link as Markdown and as HTML. */
export interface BadgeSnippet {
  readonly markdown: string;
  readonly html: string;
}

/**
 * The Markdown and the HTML of the project badge of the repository with GitHub id `githubRepoId`, on the deployment at
 * `publicBaseUrl` (`PUBLIC_BASE_URL`, which the start-up has checked is a plain http or https origin).
 * @throws InvalidSignLinkError when `githubRepoId` is not a positive safe integer or `publicBaseUrl` is not such an origin.
 */
export function badgeSnippet(publicBaseUrl: string, githubRepoId: number): BadgeSnippet {
  const sign = repositorySignUrl(publicBaseUrl, githubRepoId);
  const image = `${publicBaseUrl}${PUBLIC_BADGE_PATH.replace(':githubRepoId', String(githubRepoId))}`;
  return {
    markdown: `[![${ALT}](${image})](${sign})`,
    html: `<a href="${sign}"><img src="${image}" alt="${ALT}"></a>`,
  };
}
