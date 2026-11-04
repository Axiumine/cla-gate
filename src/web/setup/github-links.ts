// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The addresses on GitHub that the setup page puts in a link or a form (E19-S07). None is taken from a server string as it
// stands: the form target must start with GitHub's origin, and the install link is built from a slug that passed a pattern.

/** Where every address the setup page sends the browser to begins. */
const GITHUB_PREFIX = 'https://github.com/';
const GITHUB_ORIGIN = 'https://github.com';

/**
 * Whether `value` is an address on github.com over https: it starts with `https://github.com/`, parses, names no credentials,
 * and is already in the form the parser writes it in, so it holds no control character, no space and no escape the parser
 * would rewrite (a value that differs from its own parsed form is not taken for GitHub's).
 */
export function isGithubAddress(value: string): boolean {
  if (!value.startsWith(GITHUB_PREFIX) || !URL.canParse(value)) {
    return false;
  }
  const url = new URL(value);
  return url.href === value && url.origin === GITHUB_ORIGIN && url.username === '' && url.password === '';
}

/** What a slug may be (E19-S07): lower-case letters, digits and hyphens, which cannot break out of a path segment. */
const slugSchema = z.string().regex(/^[a-z0-9-]+$/u);

/** The links the credentials screen offers, each present only when what it is built from passed. */
export interface AppLinks {
  /** `https://github.com/apps/<slug>/installations/new`, built from the validated slug; `undefined` when the slug is not one. */
  readonly install: string | undefined;
  /** The App's page, the `htmlUrl` GitHub returned, when it is an address on github.com; `undefined` otherwise. */
  readonly page: string | undefined;
}

/** The links for the `slug` and `htmlUrl` of a conversion: a value that fails its check gives no link, and the credentials are shown all the same. */
export function appLinks(converted: { readonly slug: string; readonly htmlUrl: string }): AppLinks {
  const slug = slugSchema.safeParse(converted.slug);
  return {
    install: slug.success ? `${GITHUB_PREFIX}apps/${slug.data}/installations/new` : undefined,
    page: isGithubAddress(converted.htmlUrl) ? converted.htmlUrl : undefined,
  };
}
