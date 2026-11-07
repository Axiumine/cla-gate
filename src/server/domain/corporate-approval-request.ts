// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { ALLOWLIST_LOGIN_PATTERN } from '../../shared/allowlist.ts';
import { type ApprovalRequest, GITHUB_ORG_LOGIN_PATTERN } from '../../shared/corporate-approvals.ts';
import { isFreeMailDomain } from '../../shared/free-mail-domains.ts';
import { normaliseDomain } from './corporate-domain.ts';

// What a manager asked to approve (E21-S03), judged without GitHub and without the database, pure. The request is a kind and one text; this
// reads the text in the form that kind needs and refuses what can never be an account, an organisation or a company domain. Whether the
// account exists, and whether it is a person, is GitHub's to say and is asked afterwards.

/** What an approval is about once the request was read: the login to look up on GitHub, or the domain to store. */
export type ApprovalSubject =
  | { readonly kind: 'user'; readonly login: string }
  | { readonly kind: 'github_org'; readonly login: string }
  | { readonly kind: 'email_domain'; readonly domain: string };

/** The field of the request that cannot be accepted. */
type ApprovalField = 'login' | 'domain';

/** The subject to approve, or the rule the request breaks (`validation_failed` names the field; `domain_not_allowed` is a free-mail domain). */
export type ApprovalJudgement =
  | { readonly ok: true; readonly subject: ApprovalSubject }
  | { readonly ok: false; readonly rule: 'validation_failed'; readonly field: ApprovalField }
  | { readonly ok: false; readonly rule: 'domain_not_allowed' };

const refused = (field: ApprovalField): ApprovalJudgement => ({ ok: false, rule: 'validation_failed', field });

/** The domain of the request, or why it is refused: not a domain at all, or a domain anybody can get an address at. */
function judgeDomain(raw: string): ApprovalJudgement {
  const domain = normaliseDomain(raw);
  if (domain === null) {
    return refused('domain');
  }
  return isFreeMailDomain(domain)
    ? { ok: false, rule: 'domain_not_allowed' }
    : { ok: true, subject: { kind: 'email_domain', domain } };
}

/** The login of the request, trimmed, when it has the shape of a login of that kind; a person's may be a bot's (GitHub says what it is). */
function judgeLogin(kind: 'user' | 'github_org', raw: string): ApprovalJudgement {
  const login = raw.trim();
  const pattern = kind === 'user' ? ALLOWLIST_LOGIN_PATTERN : GITHUB_ORG_LOGIN_PATTERN;
  return pattern.test(login) ? { ok: true, subject: { kind, login } } : refused('login');
}

/**
 * Reads the request. A `user` login has the shape of a GitHub login (a bot's `[bot]` suffix included: GitHub answers that it is no
 * person), a `github_org` login the shape of an organisation's, an `email_domain` is a hostname that {@link normaliseDomain} accepts
 * and no free-mail domain. Whitespace around a value is not part of it; nothing else is repaired.
 */
export function judgeApprovalRequest(request: ApprovalRequest): ApprovalJudgement {
  return request.kind === 'email_domain' ? judgeDomain(request.domain) : judgeLogin(request.kind, request.login);
}
