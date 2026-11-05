// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';

// What an approval of a corporate agreement is about (E21-S03), as it is stored and read back.

/** What an approval is about as it is stored: an account or an organisation by its numeric id with the login snapshot, or a domain. */
export type StoredSubject =
  | { readonly kind: 'user' | 'github_org'; readonly githubId: GithubId; readonly login: string | null }
  | { readonly kind: 'email_domain'; readonly domain: string };

/** The numeric id an approval stores, `null` for a domain. */
export const githubIdOf = (subject: StoredSubject): GithubId | null =>
  subject.kind === 'email_domain' ? null : subject.githubId;

/** The domain an approval stores, `null` for an account or an organisation. */
export const domainOf = (subject: StoredSubject): string | null =>
  subject.kind === 'email_domain' ? subject.domain : null;

/** The subject as one text that is equal for two approvals exactly when they are about the same account, organisation or domain. */
export const subjectKey = (subject: StoredSubject): string =>
  `${subject.kind}:${githubIdOf(subject) ?? domainOf(subject)}`;
