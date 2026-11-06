// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the operator installations screen (E18-S13): the link in the user menu, the explanation that admission is the
 * instance's configuration and that operating the platform opens no tenant, the table of the installations the instance knows,
 * and the sentence for each reason an installation is rejected. They are a catalog of their own so that the main catalog stays
 * under the size cap, and the main catalog spreads them in; the rules of `messages.ts` hold for every key here.
 */
export const operatorMessages = {
  'operator.access.note':
    'Operating this instance gives no access to an organisation. Signatures, signers and CLA documents stay with the admins of each organisation, and this page carries none of them.',
  'operator.admission.admitted': 'Admitted',
  'operator.admission.note':
    'Admission is decided by the instance configuration (GITHUB_ALLOWED_ACCOUNT_IDS, see docs/configuration.md) and is not changed here. A change to the configuration takes effect when the server restarts.',
  'operator.admission.rejected': 'Rejected',
  'operator.admission.rejectedFor': 'Reason',
  'operator.admission.reason.account_not_allowed':
    'The account is not the owner of the App and is not in GITHUB_ALLOWED_ACCOUNT_IDS.',
  'operator.admission.reason.none': 'No reason recorded.',
  'operator.admission.reason.policy_changed':
    'The account was admitted before the configuration changed, and no longer is.',
  'operator.caption': 'Installations on this server',
  'operator.col.account': 'Account',
  'operator.col.admission': 'Admission',
  'operator.col.installation': 'GitHub installation',
  'operator.col.repositories': 'Repositories',
  'operator.col.state': 'State',
  'operator.col.times': 'Times (UTC)',
  'operator.col.type': 'Type',
  'operator.empty.description': 'No account has installed the GitHub App on this server yet.',
  'operator.empty.title': 'No installation yet',
  'operator.intro':
    'The accounts that have installed the GitHub App on this server and the state of each. This page is read-only.',
  'operator.link': 'Operator',
  'operator.repositories.active': '{count} active',
  'operator.repositories.enabled': '{count} enforcing',
  'operator.repositories.removed': '{count} removed',
  'operator.time.decided': 'Decided',
  'operator.time.deleted': 'Deleted',
  'operator.time.none': 'No dates recorded',
  'operator.time.suspended': 'Suspended',
  'operator.title': 'Operator installations',
} as const;
