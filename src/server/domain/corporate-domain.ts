// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
// The e-mail domain of a corporate approval (E21-S03), pure. A manager types a domain and the platform stores one form of it: lower case,
// in punycode, a dotted hostname. An address is covered by the approval when the part after its `@` is that very domain: exact
// equality and nothing implicit, so `acme.com` covers `ada@acme.com` and neither `ada@mail.acme.com` nor `ada@acme.com.evil.test`.

/** The most characters of a hostname (the limit of the column's check). */
const HOSTNAME_MAX_LENGTH = 253;

/** The most characters of what a person types, before any conversion is tried: far above any hostname, far below a body. */
const TYPED_MAX_LENGTH = 1024;

/**
 * What a typed domain is made of: letters, digits, combining marks, hyphens and dots, in any script. Checked before the conversion
 * because the URL host parser behind it reads a path, a port, a user name or a fragment as the end of the host and drops the rest (so
 * `acme.com/login` would become `acme.com`), and drops the invisible characters of the Unicode mapping (so `ac<ZWSP>me.com` would
 * become `acme.com`): a person who typed either did not type the domain they meant.
 */
const TYPED_DOMAIN = /^[\p{L}\p{N}\p{M}.-]+$/u;

/** A label that is not the last: letters, digits and inner hyphens, 1 to 63 characters. */
const LABEL = /^[a-z0-9-]{1,63}$/;

/** The last label (the top-level domain): the same, and it starts with a letter, so that an IP address is no domain. */
const TOP_LEVEL_LABEL = /^[a-z][a-z0-9-]{0,62}$/;

/** True when `label` has no hyphen at its ends. */
const hasInnerHyphens = (label: string): boolean => !label.startsWith('-') && !label.endsWith('-');

/** Whether `label` is a label that is not the last. */
const isInnerLabel = (label: string): boolean => LABEL.test(label) && hasInnerHyphens(label);

/** Whether `label` is the last label. */
const isTopLabel = (label: string): boolean => TOP_LEVEL_LABEL.test(label) && hasInnerHyphens(label);

/** Whether `name` is a dotted hostname of at least two labels in the form the approvals store (the check of the column, migration 020). */
function isStoredHostname(name: string): boolean {
  const labels = name.split('.');
  const inner = labels.slice(0, -1);
  return (
    name.length <= HOSTNAME_MAX_LENGTH &&
    inner.length >= 1 &&
    inner.every(isInnerLabel) &&
    isTopLabel(labels.slice(-1).join(''))
  );
}

/** The host of `typed` as a URL parser converts it (lower case, an internationalised name as its punycode form), or `null` when it cannot be converted. */
function hostOf(typed: string): string | null {
  try {
    return new URL(`http://${typed}`).hostname;
  } catch {
    return null;
  }
}

/**
 * The form of the domain `raw` that an approval stores, or `null` when `raw` cannot be a domain. The ends are trimmed; the name must be
 * made of letters, digits, marks, hyphens and dots only, then it is converted to ASCII the way a URL host is (lower case, an
 * internationalised name as its punycode `xn--` form), then it must be a dotted hostname: at least two labels, labels of letters,
 * digits and inner hyphens, a last label that starts with a letter, 253 characters at most. A scheme, a path, a port, an address, an
 * IP address or a name with a space is not one; a trailing dot and an empty label are not either.
 */
export function normaliseDomain(raw: string): string | null {
  const typed = raw.trim();
  if (typed.length > TYPED_MAX_LENGTH || !TYPED_DOMAIN.test(typed)) {
    return null;
  }
  const ascii = hostOf(typed);
  return ascii !== null && isStoredHostname(ascii) ? ascii : null;
}

/**
 * The domain of an e-mail address in the stored form: what follows the last `@`, normalised. `null` for an address without a local part
 * and for a domain that cannot be one.
 * @internal Exported for the tests and for the claim of E21-S04 (Knip ignores `@internal` exports in production mode).
 */
export function domainOfEmail(email: string): string | null {
  const at = email.lastIndexOf('@');
  return at < 1 ? null : normaliseDomain(email.slice(at + 1));
}

/**
 * Whether the approval of `approvedDomain` (the stored form) covers the address `email`: the domain of the address is that domain,
 * exactly. A subdomain, a parent domain and a longer name that merely starts with it are not covered.
 * @internal Exported for the tests and for the claim of E21-S04 (Knip ignores `@internal` exports in production mode).
 */
export function emailMatchesDomain(email: string, approvedDomain: string): boolean {
  return domainOfEmail(email) === approvedDomain;
}
