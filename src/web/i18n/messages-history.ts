// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the history of a CLA document (E18-S11): the versions, the viewer, the comparison and the restore dialog. They are a
 * catalog of their own so that the other catalogs stay under the size cap, and the main catalog spreads them in; the rules of
 * `messages.ts` hold for every key here (a dotted key, a `{name}` placeholder, a `.one` with its `.other`).
 */
export const historyMessages = {
  'document.tabs.history': 'History',
  'history.caption': 'Published versions of this document, newest first',
  'history.col.actions': 'Actions',
  'history.col.hash': 'SHA-256 (start)',
  'history.col.published': 'Published (UTC)',
  'history.col.publishedBy': 'Published by',
  'history.col.rationale': 'What changed',
  'history.col.signatures': 'Signatures',
  'history.col.status': 'Status',
  'history.col.version': 'Version',
  'history.compare': 'Compare versions',
  'history.compare.close': 'Close the comparison',
  'history.compare.from': 'From version (older)',
  'history.compare.idOnly': 'Version with id {id}',
  'history.compare.needTwo': 'A comparison needs two versions, and this document has fewer than that.',
  'history.compare.option': 'Version {version}',
  'history.compare.option.active': 'Version {version} (active)',
  'history.compare.same': 'No differences',
  'history.compare.title': 'Compare two versions',
  'history.compare.to': 'To version (newer)',
  'history.diff.added': 'Added:',
  'history.diff.label': 'Lines that differ between version {from} and version {to}',
  'history.diff.removed': 'Removed:',
  'history.diff.unchanged.hide.one': 'Hide {count} unchanged line',
  'history.diff.unchanged.hide.other': 'Hide {count} unchanged lines',
  'history.diff.unchanged.show.one': 'Show {count} unchanged line',
  'history.diff.unchanged.show.other': 'Show {count} unchanged lines',
  'history.empty.description':
    'Write the text in the editor, save it as a draft and publish it. The first version appears here.',
  'history.empty.title': 'No version has been published yet',
  'history.intro':
    'Every published version, newest first. A published version is never edited or deleted: a mistake is fixed by publishing a new version.',
  'history.publishedBy.id': 'GitHub id',
  'history.rationale.less': 'Show less',
  'history.rationale.more': 'Show all',
  'history.title': 'Versions',
  'history.view': 'View',
  'history.view.label': 'View version {version}',
  'history.viewer.close': 'Close the version',
  'history.viewer.facts.hash': 'SHA-256 of the text',
  'history.viewer.facts.published': 'Published (UTC)',
  'history.viewer.facts.publishedBy': 'Published by',
  'history.viewer.facts.rationale': 'What changed',
  'history.viewer.facts.signatures': 'Signatures on this version',
  'history.viewer.text': 'Text of version {version}',
  'history.viewer.title': 'Version {version}',
  'restore.action': 'Restore this text',
  'restore.description':
    'Publishing creates a new version with this text. Version {version} is never reactivated: it stays in the history exactly as it is.',
  'restore.title': 'Restore the text of version {version}',
} as const;
