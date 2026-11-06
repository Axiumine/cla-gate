// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the pending pull requests and commit overrides screen (E18-S08): the list of blocked pull requests with the reason for
 * each, the dialog that records an override, and the overrides of a repository with their removal. They are a catalog of their own so
 * that the main catalog stays under the size cap, and the main catalog spreads them in; the rules of `messages.ts` hold for every key
 * here (a dotted key, a `{name}` placeholder, a `.one` with its `.other`).
 */
export const pendingMessages = {
  'pending.account.unseen': 'account not seen yet (GitHub id {id})',
  'pending.caption': 'Pending pull requests of this installation',
  'pending.col.commit': 'Head commit',
  'pending.col.evaluated': 'Last checked',
  'pending.col.pr': 'Pull request',
  'pending.col.reasons': 'Why it is blocked',
  'pending.col.repository': 'Repository',
  'pending.count.one': '{count} pending pull request on this page',
  'pending.count.other': '{count} pending pull requests on this page',
  'pending.empty.filtered':
    'No pending pull request matches these filters. Change the repository or the reason, or clear them.',
  'pending.empty.none': 'Every open pull request is covered or exempt.',
  'pending.empty.title': 'No pending pull requests',
  'pending.filter.reason': 'Reason',
  'pending.filter.reason.all': 'All reasons',
  'pending.filter.repository': 'Repository',
  'pending.filter.repository.all': 'All repositories',
  'pending.help':
    'A pull request is checked again by itself after a signature, an override or an allowlist change, so there is no button for it here. Anyone can also comment /recheck on a pull request. A signature or override recorded elsewhere appears in this list after the next refresh, which happens when you return to this window.',
  'pending.intro':
    'The open pull requests that the CLA check blocks, with the reason for each, and the commits that are allowed by an override.',
  'pending.notice.recorded':
    'Override recorded. The pull request is checked again and leaves this list when it passes.',
  'pending.override': 'Record override',
  'pending.override.commit': 'Commit',
  'pending.override.commit.help': 'The full commit id, 40 or 64 hexadecimal characters. It cannot be changed here.',
  'pending.override.description':
    'This allows the commit without implying a signature and is written to the audit log.',
  'pending.override.label': 'Record override for commit {commit} of {repository}',
  'pending.override.reason': 'Reason',
  'pending.override.reason.help':
    'Why this commit may pass without a signed CLA, in 1 to 2000 characters. Other maintainers read it.',
  'pending.override.reason.invalid': 'Write a reason of 1 to 2000 characters, with no control characters.',
  'pending.override.repository': 'Repository',
  'pending.override.sha.invalid':
    'This is not a full commit id (40 or 64 hexadecimal characters), so no override can be recorded for it.',
  'pending.override.submit': 'Record override',
  'pending.override.title': 'Record an override',
  'pending.overrides.caption': 'Commit overrides of this repository',
  'pending.overrides.choose.description': 'Choose a repository to see the commits that are allowed by an override.',
  'pending.overrides.choose.title': 'Choose a repository',
  'pending.overrides.col.actions': 'Actions',
  'pending.overrides.col.commit': 'Commit',
  'pending.overrides.col.createdBy': 'Recorded by',
  'pending.overrides.col.created': 'Recorded',
  'pending.overrides.col.reason': 'Reason',
  'pending.overrides.count.one': '{count} override on this page',
  'pending.overrides.count.other': '{count} overrides on this page',
  'pending.overrides.empty.description': 'No commit of this repository is allowed by an override.',
  'pending.overrides.empty.title': 'No overrides',
  'pending.overrides.intro':
    'An override waives the check for the author and committer of one commit. It never counts as a signature. An override cannot be edited: remove it and record a new one from the pending list.',
  'pending.overrides.notice.gone': 'That override was already removed. The list is up to date.',
  'pending.overrides.notice.removed': 'Override removed. Pull requests that relied on it are checked again.',
  'pending.overrides.remove': 'Remove',
  'pending.overrides.remove.confirm': 'Remove override',
  'pending.overrides.remove.description':
    'The commit has to be covered by a signed CLA or the allowlist again, so a green check that relied on this override may turn red.',
  'pending.overrides.remove.label': 'Remove the override of commit {commit}',
  'pending.overrides.remove.title': 'Remove the override of commit',
  'pending.overrides.repository': 'Repository',
  'pending.overrides.repository.choose': 'Choose a repository',
  'pending.overrides.repository.help': 'Overrides are kept for one repository at a time.',
  'pending.pr': 'PR #{number}',
  'pending.pr.link': 'PR #{number} of {repository} on GitHub',
  'pending.reason.bot_not_allowlisted': 'Bot is not on the allowlist:',
  'pending.reason.commit_limit_exceeded': 'The pull request has more commits than can be checked.',
  'pending.reason.no_active_cla': 'The repository has no active CLA version.',
  'pending.reason.other': 'The check could not finish for another reason.',
  'pending.reason.unlinked_identity':
    'A commit has an author or committer email that GitHub cannot link to an account:',
  'pending.reason.unsigned_contributor': 'Has not signed the CLA:',
  'pending.reasonName.bot_not_allowlisted': 'Bot not on the allowlist',
  'pending.reasonName.commit_limit_exceeded': 'Too many commits',
  'pending.reasonName.no_active_cla': 'No active CLA',
  'pending.reasonName.other': 'Another reason',
  'pending.reasonName.unlinked_identity': 'Email not linked to an account',
  'pending.reasonName.unsigned_contributor': 'Not signed',
  'pending.repository.byId': 'Repository {id}',
  'pending.repository.more': 'Only the first {count} repositories are listed.',
  'pending.results.title': 'Results',
  'pending.rule.commit_not_found':
    'GitHub does not have this commit in the repository. It may have been removed by a force push.',
  'pending.rule.installation_suspended':
    'This installation is suspended on GitHub, so nothing can be changed until it is active again.',
  'pending.rule.override_exists':
    'This commit has an override already. Close this dialog; the list is refreshed when you return.',
  'pending.rule.repository_disabled':
    'This repository does not enforce the CLA now, so no override can be recorded for it.',
  'pending.tab.overrides': 'Overrides',
  'pending.tab.pending': 'Pending pull requests',
  'pending.tabs.label': 'Pending pull requests and overrides',
  'pending.title': 'Pending and overrides',
  'pending.truncated':
    'Some repositories were left out because too many of them have pending pull requests. Choose a repository to see all of its pull requests.',
  'tenant.nav.pending': 'Pending',
} as const;
