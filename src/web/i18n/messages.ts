// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The English message catalog (E17-S02): every string the user can read, under a dotted key. A flat `as const` object, so
 * the type of each message is its literal text and the `{name}` placeholders in it can be read by the compiler. A message
 * holds placeholders written `{name}` (a lower-case letter, then letters and digits) and no other brace. A plural is two
 * keys, `<base>.one` and `<base>.other`, that use the same placeholders; `t.plural(<base>, count)` picks between them.
 *
 * A second language is a second object of the same keys. Each story that shows text adds its keys here, and no component
 * writes text inline (the lint rule in scripts/web/eslint-config.ts enforces it).
 */
export const messages = {
  'app.name': 'CLA Platform',
  'app.pageTitle': '{title} · CLA',
  'auth.login': 'Log in with GitHub',
  'auth.logout': 'Log out',
  'auth.sessionEnded': 'Your session ended',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.required': '(required)',
  'common.unknownDate': 'Unknown date',
  'errors.bad_request': 'The request was not valid. Check what you entered and try again.',
  'errors.conflict': 'This changed while you were working on it. Reload the page and try again.',
  'errors.contract':
    'The server answered in a way this page does not understand. Reload the page, and give the request ID to support if it keeps happening.',
  'errors.csrf_invalid': 'Your session could not be verified. Reload the page and try again.',
  'errors.forbidden': 'You do not have access to this page.',
  'errors.internal_server_error': 'The server hit an unexpected problem. Try again in a moment.',
  'errors.method_not_allowed': 'This action is not supported.',
  'errors.network': 'The server could not be reached. Check your connection and try again.',
  'errors.not_found': 'We could not find what you asked for.',
  'errors.origin_not_allowed':
    'The server does not trust the page this request came from. Open the app from its own address and try again.',
  'errors.payload_too_large': 'What you sent is too large.',
  'errors.request_header_fields_too_large': 'The request was too large. Clear the cookies of this site and try again.',
  'errors.request_timeout': 'The request took too long. Try again.',
  'errors.service_unavailable': 'The service is not available right now. Try again in a moment.',
  'errors.too_many_requests': 'Too many requests. Wait a moment before trying again.',
  'errors.unauthenticated': 'Your session ended. Log in again to continue.',
  'errors.unauthorized': 'You need to log in to continue.',
  'errors.unexpected_response': 'The server answered in a way this page does not understand. Try again in a moment.',
  'errors.unknown': 'An unexpected error occurred. Try again in a moment.',
  'errors.unprocessable_entity': 'What you entered could not be processed. Check it and try again.',
  'errors.unsupported_media_type': 'The server does not accept that kind of content.',
  'errors.uri_too_long': 'The address of the request was too long.',
  'footer.licence': 'Licensed under {licence}',
  'footer.sourceCode': 'Source code',
  'landing.signedIn': 'You are logged in.',
  'landing.tagline': 'Contributor License Agreements, checked on every pull request.',
  'landing.title': 'Home',
  'login.failed.access_denied': 'You cancelled the login at GitHub. Nothing was changed.',
  'login.failed.bad_request': 'The login request was not valid. Try again.',
  'login.failed.exchange_failed': 'GitHub did not complete the login. Try again.',
  'login.failed.generic': 'The login could not be completed. Try again.',
  'login.failed.github_unavailable': 'GitHub is not available right now. Try again in a moment.',
  'login.failed.home': 'Go to the home page',
  'login.failed.retry': 'Try again',
  'login.failed.state_mismatch':
    'The login did not start from this browser, or took too long. Start it again from this page.',
  'login.failed.title': 'Login failed',
  'login.failed.unsupported_account': 'This kind of GitHub account cannot log in here. Use a personal account.',
  'nav.home': 'Home',
  'nav.label': 'Main',
  'nav.menu': 'Menu',
  'nav.skip': 'Skip to content',
  'pager.failed': 'That page could not be loaded. The page you see has not changed.',
  'pager.label': 'Pagination',
  'pager.later': 'A later page',
  'pager.next': 'Next',
  'pager.page': 'Page {page}',
  'pager.previous': 'Previous',
  'states.copied': 'Request ID copied',
  'states.copyFailed': 'The request ID could not be copied',
  'states.copyRequestId': 'Copy request ID',
  'states.crash.reload': 'Reload',
  'states.error.title': 'Something went wrong',
  'states.forbidden.title': 'Access denied',
  'states.loading': 'Loading',
  'states.notFound.home': 'Go to the home page',
  'states.notFound.message': 'The page you asked for does not exist or has moved.',
  'states.notFound.title': 'Page not found',
  'states.requestId': 'Request ID',
  'states.retry': 'Try again',
  'states.retryIn.one': 'You can try again in {count} second.',
  'states.retryIn.other': 'You can try again in {count} seconds.',
  'status.active': 'Active',
  'status.cancelled': 'Cancelled',
  'status.disabled': 'Disabled',
  'status.draft': 'Draft',
  'status.enabled': 'Enabled',
  'status.failed': 'Failed',
  'status.outdated': 'Outdated',
  'status.passed': 'Passed',
  'status.pending': 'Pending',
  'status.revoked': 'Revoked',
  'status.suspended': 'Suspended',
  'theme.dark': 'Dark',
  'theme.label': 'Theme',
  'theme.light': 'Light',
  'theme.system': 'System',
} as const;

/** The type of the catalog itself, whose literal messages the placeholder types are read from. */
export type Messages = typeof messages;

/** A key of the catalog: `t('typo')` fails `tsc`. */
export type MessageKey = keyof Messages;

/** A key whose message has no `{name}` placeholder: one that can be shown without parameters, such as the title of a page. */
export type PlainMessageKey = {
  [Key in MessageKey]: Messages[Key] extends `${string}{${string}` ? never : Key;
}[MessageKey];
