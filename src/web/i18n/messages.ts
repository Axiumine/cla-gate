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
  'errors.github_unexpected_response':
    'GitHub answered in a way this server does not understand. Start again from the setup page.',
  'errors.github_unreachable': 'GitHub could not be reached. Try again in a moment.',
  'errors.internal_server_error': 'The server hit an unexpected problem. Try again in a moment.',
  'errors.invalid_setup_token':
    'That is not the setup token. It is the content of the file secrets/setup_token on the server. Check it and try again.',
  'errors.method_not_allowed': 'This action is not supported.',
  'errors.network': 'The server could not be reached. Check your connection and try again.',
  'errors.not_found': 'We could not find what you asked for.',
  'errors.origin_mismatch':
    'This page was not opened at the public address of the server (PUBLIC_BASE_URL), so the server refuses it. Open the setup at that address.',
  'errors.origin_not_allowed':
    'The server does not trust the page this request came from. Open the app from its own address and try again.',
  'errors.payload_too_large': 'What you sent is too large.',
  'errors.request_header_fields_too_large': 'The request was too large. Clear the cookies of this site and try again.',
  'errors.request_timeout': 'The request took too long. Try again.',
  'errors.service_unavailable': 'The service is not available right now. Try again in a moment.',
  'errors.setup_already_issued':
    'This server already issued the credentials of its App. To set up again, delete the App on GitHub and restart the container.',
  'errors.setup_code_invalid':
    "GitHub's one-time code was already used, is older than an hour or does not belong to this setup. Start again from the setup page.",
  'errors.setup_locked':
    'The setup session has ended or was never opened. Start again from the setup page and enter the setup token.',
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
  'me.download.button': 'Download my data',
  'me.download.done': 'Your data was saved as {name}.',
  'me.download.help':
    'One JSON file with everything this server holds about you: your signatures with the details you gave when you signed, the allowlist entries that name you, and the audit entries about you.',
  'me.signatures.caption': 'Your signatures, newest first',
  'me.signatures.col.document': 'Document',
  'me.signatures.col.organisation': 'Organisation',
  'me.signatures.col.signed': 'Signed (UTC)',
  'me.signatures.col.source': 'Signed from',
  'me.signatures.col.status': 'Status',
  'me.signatures.col.version': 'Version',
  'me.signatures.empty.description':
    'When you sign a Contributor License Agreement from the link in a pull request comment, it is listed here.',
  'me.signatures.empty.title': 'You have not signed any CLA yet',
  'me.signatures.notice.body':
    'The maintainers of an organisation can see the name you typed, your GitHub login and the verified email address you chose when you signed its CLA. This list shows your own signatures to you only, and it does not repeat any of the three.',
  'me.signatures.notice.title': 'What maintainers can see',
  'me.signatures.outdated': 'A newer major version of this CLA is required.',
  'me.signatures.revokedOn': 'Revoked on',
  'me.signatures.signAgain': 'Sign again',
  'me.signatures.source.none': 'Not recorded',
  'me.signatures.source.pr': 'Pull request #{number}',
  'me.signatures.title': 'My signatures',
  'nav.home': 'Home',
  'nav.label': 'Main',
  'nav.menu': 'Menu',
  'nav.signatures': 'My signatures',
  'nav.skip': 'Skip to content',
  'pager.failed': 'That page could not be loaded. The page you see has not changed.',
  'pager.label': 'Pagination',
  'pager.later': 'A later page',
  'pager.next': 'Next',
  'pager.page': 'Page {page}',
  'pager.previous': 'Previous',
  'repository.badge.copied': 'The {name} snippet was copied.',
  'repository.badge.copy': 'Copy',
  'repository.badge.copyNamed': 'Copy the {name} snippet',
  'repository.badge.copyUnavailable':
    'This browser cannot copy to the clipboard. Select the text and copy it yourself.',
  'repository.badge.enforcement': 'The badge is shown while the CLA is enforced for this repository.',
  'repository.badge.html': 'HTML',
  'repository.badge.intro':
    'A badge in your README tells contributors that this project asks them to sign the CLA, and links them to the signing page. Turning it on also opens a public check of whether one GitHub login has signed: it answers yes or no and shows no name, e-mail address or date.',
  'repository.badge.markdown': 'Markdown',
  'repository.badge.offHint': 'Turn the public badge on to get the snippet for your README.',
  'repository.badge.pasteTitle': 'Paste this in your README',
  'repository.badge.title': 'Public badge',
  'repository.badge.toggle': 'Show the public badge and allow the public signature check',
  'repository.badge.turnedOff': 'The public badge is off.',
  'repository.badge.turnedOn': 'The public badge is on.',
  'repository.settings.title': 'Repository settings',
  'setup.app.httpWarning':
    'This server is not reached over https, so GitHub cannot deliver webhooks to it and the webhook of the App will be inactive. Use an https address (PUBLIC_BASE_URL) or a tunnel before you rely on it.',
  'setup.app.intro': 'This server runs one GitHub App. Nothing is created until you confirm on GitHub.',
  'setup.app.name': 'App name',
  'setup.app.nameHelp': 'Shown on GitHub: 1 to 34 letters, digits, spaces and hyphens.',
  'setup.app.nameInvalid': 'Use 1 to 34 letters, digits, spaces or hyphens.',
  'setup.app.organisation': 'Organisation login',
  'setup.app.organisationHelp': 'The login of the GitHub organisation, as it appears in its address.',
  'setup.app.organisationInvalid':
    'Enter a GitHub login: letters, digits and hyphens, 1 to 39 characters, not starting or ending with a hyphen.',
  'setup.app.owner': 'Who will own the App?',
  'setup.app.ownerOrganisation': 'An organisation',
  'setup.app.ownerUser': 'A personal account',
  'setup.app.public': 'Let other organisations install this App',
  'setup.app.publicHelp':
    'An App owned by one account can only be installed by that account. Serving several organisations needs a public App. The admission policy of this instance still decides which organisations may use this server.',
  'setup.app.submit': 'Create the GitHub App on GitHub',
  'setup.app.title': 'Create the GitHub App',
  'setup.callback.get': 'Get the credentials',
  'setup.callback.intro':
    'GitHub sent you back with a one-time code. Press the button to exchange it for the credentials of the App. They are shown once.',
  'setup.callback.invalid':
    'This address is not the one GitHub sends you back to after it creates the App, or its code is not valid. Start again from the setup page.',
  'setup.callback.invalidTitle': 'This is not a return from GitHub',
  'setup.callback.title': 'GitHub created the App',
  'setup.credentials.appPage': 'Open the App on GitHub',
  'setup.credentials.once':
    "These values are shown once. Save them now: this page cannot show them again and the server does not keep them. GitHub's settings page of the App can generate a new client secret and a new private key if you lose them.",
  'setup.credentials.publicTitle': 'Public values, for the .env file',
  'setup.credentials.secretTitle': 'Secrets, one file each',
  'setup.credentials.title': 'The credentials of your App',
  'setup.item.copied': '{name} copied.',
  'setup.item.copy': 'Copy',
  'setup.item.copyNamed': 'Copy {name}',
  'setup.item.copyUnavailable':
    'Copying is not available in this browser. Select the value and copy it by hand, or use Download.',
  'setup.item.download': 'Download',
  'setup.item.downloadNamed': 'Download {name}',
  'setup.item.hide': 'Hide',
  'setup.item.hideNamed': 'Hide {name}',
  'setup.item.reveal': 'Reveal',
  'setup.item.revealNamed': 'Reveal {name}',
  'setup.next.env': 'Put GITHUB_APP_ID and GITHUB_CLIENT_ID into the .env file.',
  'setup.next.install': 'Install the App on each organisation that should use it, through its install link.',
  'setup.next.installLink': 'Install the App on GitHub',
  'setup.next.noLink':
    'The install link could not be built from what GitHub returned. Open the App on GitHub and install it from there.',
  'setup.next.restart': 'Restart the stack with docker compose up -d.',
  'setup.next.save': 'Save the three secrets as files in the secrets directory of the server, named as shown above.',
  'setup.next.title': 'Next steps',
  'setup.post.continue': 'Continue to GitHub',
  'setup.post.intro': 'GitHub asks you to confirm the App. If nothing happens, use the button.',
  'setup.post.refused': "The address the App would be sent to is not one of GitHub's. Nothing was sent.",
  'setup.post.title': 'Taking you to GitHub',
  'setup.startAgain': 'Start again from the setup page',
  'setup.title': 'Set up the GitHub App',
  'setup.unlock.intro':
    'This server has no GitHub App yet. Enter the setup token to create it. The token is the content of the file secrets/setup_token on the server.',
  'setup.unlock.submit': 'Unlock',
  'setup.unlock.title': 'Unlock the setup',
  'setup.unlock.token': 'Setup token',
  'sign.blocked.check': 'Check again',
  'sign.blocked.message':
    'GitHub reported no verified email address for your account when you logged in. A signature is recorded with one of your verified addresses, and there is no way to type one here.',
  'sign.blocked.relogin': 'Log in again',
  'sign.blocked.settings': 'Open your GitHub email settings (new tab)',
  'sign.blocked.steps':
    'Add and verify an email address in your GitHub settings. GitHub tells this site your addresses when you log in, so log in again afterwards. If you already did that in another tab, press Check again.',
  'sign.blocked.still': 'Checked again: nothing has changed yet.',
  'sign.blocked.title': 'You need a verified email address to sign',
  'sign.cannot.message': 'This page cannot offer the signing form at the moment. Check again in a moment.',
  'sign.cannot.title': 'You cannot sign right now',
  'sign.consent.required': 'You must agree before you can sign.',
  'sign.done.existing':
    'You had already signed this version in another window. That signature stands, and the name you typed here was not stored.',
  'sign.done.name': 'Name',
  'sign.done.pullRequest': 'Go to the pull request',
  'sign.done.signedAt': 'Signed',
  'sign.done.title': 'You signed the CLA',
  'sign.done.update': 'The check on the pull request will update shortly. You can close this page.',
  'sign.email.help':
    'Choose one of the email addresses that GitHub has verified for your account. It is stored with your signature.',
  'sign.email.label': 'Email address',
  'sign.email.none': 'GitHub reported no verified email address for your account, so there is nothing to choose from.',
  'sign.email.notVerified': 'GitHub does not list that address as verified for your account. Choose another one.',
  'sign.email.primary': 'primary',
  'sign.email.required': 'Choose one of your verified email addresses.',
  'sign.fingerprint.covers':
    'The fingerprint is the SHA-256 hash of the exact source text shown above, character for character.',
  'sign.fingerprint.label': 'Text fingerprint',
  'sign.fingerprint.show': 'Show the full fingerprint',
  'sign.form.title': 'Your signature',
  'sign.login.after': 'The agreement is shown after you log in, and you come back to this page.',
  'sign.login.intro':
    'Signing records your agreement to this Contributor License Agreement against your GitHub account. Here is what happens.',
  'sign.login.step.account': 'You log in with GitHub. Your verified email addresses are read once, at login.',
  'sign.login.step.read':
    'You read the agreement, type your full name and choose one of your verified email addresses.',
  'sign.login.step.visible':
    'The maintainers of the organisation can see the name you typed, your GitHub login and the email address you chose.',
  'sign.login.title': 'Log in to sign the CLA',
  'sign.name.help': 'Type your full name as it should appear in the record: 1 to 200 characters.',
  'sign.name.invalid':
    'Enter your full name: 1 to 200 characters, with no control characters and no characters that change the text direction.',
  'sign.name.label': 'Full name',
  'sign.noCla.message':
    'This repository has no Contributor License Agreement in force at the moment. If you expected one, ask the maintainers of the repository.',
  'sign.noCla.title': 'There is nothing to sign here',
  'sign.published': 'Published',
  'sign.rationale': 'What changed in this version',
  'sign.repository': 'Repository',
  'sign.resign.message':
    'You signed major version {signed}. The agreement is now at version {current}, which needs your signature again.',
  'sign.resign.messageNew': 'The agreement is now at version {current}, which needs your signature again.',
  'sign.resign.title': 'You need to sign the new version',
  'sign.revoked.message':
    'A revocation applies to future pull requests only: pull requests that were already checked keep their result. Sign below to be covered again.',
  'sign.revoked.on': 'Revoked',
  'sign.revoked.title': 'Your earlier signature was revoked',
  'sign.signed.mine': 'See your signatures',
  'sign.signed.noAction': 'No action needed.',
  'sign.signed.title': 'You have already signed',
  'sign.stale.message':
    'Nothing was recorded and your consent was cleared. Review the new version, then give your consent again.',
  'sign.stale.review': 'Review the new version',
  'sign.stale.title': 'The CLA changed while you were reading',
  'sign.submit': 'Sign the CLA',
  'sign.text.label': 'Text of the Contributor License Agreement',
  'sign.title': 'Sign the CLA',
  'sign.version': 'Version',
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
