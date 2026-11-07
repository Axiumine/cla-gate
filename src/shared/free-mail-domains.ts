// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The mail domains that anybody can get an address at (E21-S03). A corporate approval by e-mail domain says "everybody with an address at
// this domain works for the company", which is true of the domain of a company and false of these: approving one would cover every
// stranger with a free mailbox. The list lives in this one file; the check is an exact equality of the domain in the form the
// approvals store (lower case, punycode), so a subdomain of one of them is not on it and a company domain is never refused by accident.

/**
 * The free-mail domains an approval refuses, in the form the approvals store.
 * @internal Exported for the tests (Knip ignores `@internal` exports in production mode).
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'aol.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
  'zoho.com',
]);

/** Whether `domain` (lower case, punycode) is one of {@link FREE_MAIL_DOMAINS}. */
export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL_DOMAINS.has(domain);
}
