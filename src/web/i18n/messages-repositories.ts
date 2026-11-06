// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the Repositories screen (E18-S10): the list of repositories with the CLA each one enforces, the search and the
 * filter, the dialog that attaches or detaches a document, the switch that turns the check on, the question that turns it off, and the
 * words for the rules the server refuses with. They are a catalog of their own so that the main catalog stays under the size cap, and
 * the main catalog spreads them in; the rules of `messages.ts` hold for every key here (a dotted key, a `{name}` placeholder, a `.one`
 * with its `.other`).
 */
export const repositoryMessages = {
  'repositories.attach': 'Attach CLA',
  'repositories.attach.change': 'Change CLA',
  'repositories.attach.changeLabel': 'Change the CLA of {repository}',
  'repositories.attach.description':
    'Choose the document that contributors to this repository sign. Only a document with a published version can be attached. Choosing no CLA detaches the document, which needs the check to be off.',
  'repositories.attach.field': 'CLA document',
  'repositories.attach.label': 'Attach a CLA to {repository}',
  'repositories.attach.none': 'No CLA (detach)',
  'repositories.attach.option.installation': '{name} ({version}), whole installation',
  'repositories.attach.option.repository': '{name} ({version}), this repository only',
  'repositories.attach.submit': 'Save',
  'repositories.attach.title': 'CLA document of',
  'repositories.attach.unpublished': 'not published',
  'repositories.caption': 'Repositories of this installation',
  'repositories.cla.none': 'No CLA attached',
  'repositories.cla.unpublished': 'not published',
  'repositories.col.actions': 'Actions',
  'repositories.col.cla': 'CLA',
  'repositories.col.name': 'Repository',
  'repositories.col.status': 'Status',
  'repositories.count.one': '{count} repository on this page',
  'repositories.count.other': '{count} repositories on this page',
  'repositories.disable': 'Disable',
  'repositories.disable.confirm': 'Disable',
  'repositories.disable.description':
    'New license/cla checks stop for this repository. Open pull requests get a neutral result. Existing check results and the history of signatures stay.',
  'repositories.disable.label': 'Disable the CLA check for {repository}',
  'repositories.disable.title': 'Turn off the CLA check for',
  'repositories.editor': 'Open the CLA editor',
  'repositories.empty.filtered': 'No repository matches this search. Change the search or the filter, or clear them.',
  'repositories.empty.none':
    'GitHub lists no repository for this installation, or you administer none of the ones it lists.',
  'repositories.empty.title': 'No repositories',
  'repositories.enable': 'Enable',
  'repositories.enable.label': 'Enable the CLA check for {repository}',
  'repositories.filter.enabled': 'Enforcement',
  'repositories.filter.enabled.all': 'All repositories',
  'repositories.fix.attach': 'Attach a CLA',
  'repositories.fix.documents': 'Open the CLA documents',
  'repositories.intro':
    'A repository checks pull requests against a CLA once a document with a published version is attached and the check is enabled. Search and filters are part of the address, so you can share a view.',
  'repositories.notice.attached': 'A CLA is attached to {repository}.',
  'repositories.notice.detached': 'The CLA is detached from {repository}.',
  'repositories.notice.disabled': 'The CLA check is off for {repository}.',
  'repositories.notice.enabled': 'The CLA check is on for {repository}.',
  'repositories.notice.gone': '{repository} is not in this installation any more.',
  'repositories.notice.unchanged': 'Nothing changed for {repository}: it already was that way.',
  'repositories.results.title': 'Repository list',
  'repositories.rule.document_not_attachable':
    'This repository cannot enforce that document. Choose another one from the list.',
  'repositories.rule.document_unpublished':
    'That document has no published version yet, so there is nothing to sign. Publish a version first.',
  'repositories.rule.installation_suspended':
    'This installation is suspended on GitHub, so nothing can be changed until it is active again.',
  'repositories.rule.no_active_cla':
    'This repository cannot enforce a CLA yet: attach a CLA and publish a version first.',
  'repositories.rule.repository_enabled':
    'The CLA check is on for this repository, so its CLA cannot be detached. Disable the check first.',
  'repositories.search.field': 'Repository name',
  'repositories.search.help': 'Part of the full name, such as acme/widgets, in any case.',
  'repositories.search.label': 'Search repositories',
  'repositories.title': 'Repositories',
  'tenant.nav.repositories': 'Repositories',
} as const;
