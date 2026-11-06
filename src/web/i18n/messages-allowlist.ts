// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the allowlist screen (E18-S06): the scope choice, the list, the add dialog with its rules, and the removal. They are a
 * catalog of their own so that the main catalog stays under the size cap, and the main catalog spreads them in; the rules of `messages.ts`
 * hold for every key here (a dotted key, a `{name}` placeholder, a `.one` with its `.other`).
 */
export const allowlistMessages = {
  'allowlist.add': 'Add entry',
  'allowlist.add.description':
    'The account is looked up on GitHub when you add the entry, and it is exempted by its numeric GitHub id. Only the login is needed.',
  'allowlist.add.kind': 'Kind',
  'allowlist.add.login': 'GitHub login',
  'allowlist.add.loginHelp':
    'The login of the account, for example octocat. The server looks it up on GitHub. The login of a bot ends in [bot].',
  'allowlist.add.orgMembers.exists':
    'The members of the organisation are already on the allowlist of this scope. Remove that entry to add it again.',
  'allowlist.add.orgMembers.userAccount':
    'Not available: this installation belongs to a user account, which has no organisation members.',
  'allowlist.add.submit': 'Add to allowlist',
  'allowlist.add.title': 'Add an allowlist entry',
  'allowlist.caption': 'Allowlist entries of this scope',
  'allowlist.col.actions': 'Actions',
  'allowlist.col.added': 'Added',
  'allowlist.col.addedBy': 'Added by',
  'allowlist.col.kind': 'Kind',
  'allowlist.col.scope': 'Scope',
  'allowlist.col.subject': 'Account',
  'allowlist.empty.description':
    'Accounts on the allowlist are exempt from signing the CLA. A bot is matched by its account type and its numeric GitHub id, and a person by numeric GitHub id. The logins shown are display snapshots only: they can be out of date after a rename and are never what matching reads.',
  'allowlist.empty.title': 'No allowlist entries',
  'allowlist.entries.title': 'Entries',
  'allowlist.entryScope.installation': 'Installation',
  'allowlist.entryScope.repository': 'Repository',
  'allowlist.inherited.caption': 'Allowlist entries that apply from the installation',
  'allowlist.inherited.description':
    'These entries were made for the whole installation and also exempt accounts in this repository. They are changed from the whole-installation scope.',
  'allowlist.inherited.title': 'Applies from the installation',
  'allowlist.intro':
    'Accounts on the allowlist are exempt from signing the CLA. An entry covers the whole installation or one repository.',
  'allowlist.kind.bot': 'Bot',
  'allowlist.kind.org_members': 'Members of the organisation',
  'allowlist.kind.user': 'User',
  'allowlist.more': 'Show more entries',
  'allowlist.notice.added': 'Entry added.',
  'allowlist.notice.gone':
    'That entry was not found: it was removed already, or it is not part of this installation. The list is up to date.',
  'allowlist.notice.removed': 'Entry removed.',
  'allowlist.orgMembers.confirm': 'Exempt every member',
  'allowlist.orgMembers.description':
    'Every current and future member of the organisation, including private members, becomes exempt from signing the CLA in this scope. Nobody is asked to sign while they are a member.',
  'allowlist.orgMembers.title': 'Exempt every member of the organisation?',
  'allowlist.pick.description':
    'As a repository admin you manage the allowlist of each repository you administer. Choose one above to see its entries.',
  'allowlist.pick.title': 'Choose a repository',
  'allowlist.remove': 'Remove',
  'allowlist.remove.addedBy': 'Added by',
  'allowlist.remove.confirm': 'Remove entry',
  'allowlist.remove.description.account':
    'This account is no longer exempt from signing the CLA. Its open pull requests are checked again.',
  'allowlist.remove.description.orgMembers':
    'The members of the organisation are no longer exempt from signing the CLA. Open pull requests are checked again.',
  'allowlist.remove.label': 'Remove {account}',
  'allowlist.remove.title': 'Remove from the allowlist:',
  'allowlist.rule.allowlist_entry_exists': 'This account is already on the allowlist of this scope.',
  'allowlist.rule.github_account_not_found': 'GitHub has no account with this login. Check the spelling.',
  'allowlist.rule.invalid_login':
    'Enter a GitHub login: letters, digits and hyphens, up to 39 characters, and [bot] at the end for a bot.',
  'allowlist.rule.kind_mismatch':
    'This account is not of the kind you chose. A person is added as a user and an automation as a bot. For the members of an organisation, choose "Members of the organisation".',
  'allowlist.rule.members_permission_missing':
    'The GitHub App may not list the members of the organisation yet. Open the installation page of the App on your organisation on GitHub, accept the updated permissions, then try again.',
  'allowlist.rule.no_organization':
    'This installation belongs to a user account, which has no organisation members. Add the account as a user instead.',
  'allowlist.scope': 'Scope',
  'allowlist.scope.choose': 'Choose a repository',
  'allowlist.scope.help':
    'The whole installation, or one repository. An entry for the installation covers every repository of it.',
  'allowlist.scope.installation': 'The whole installation',
  'allowlist.scope.more': 'Only the first {count} repositories are listed.',
  'allowlist.scope.repositoryById': 'Repository {id}',
  'allowlist.subject.unknownLogin': 'Login not recorded',
  'allowlist.title': 'Allowlist',
  'tenant.nav.allowlist': 'Allowlist',
} as const;
