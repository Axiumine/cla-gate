// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the signatures screen (E18-S07): the search and the filters, the table and its row detail, the revocation with its
 * reasons, and the CSV export. They are a catalog of their own so that the main catalog stays under the size cap, and the main catalog
 * spreads them in; the rules of `messages.ts` hold for every key here (a dotted key, a `{name}` placeholder, a `.one` with its `.other`).
 */
export const signatureMessages = {
  'signatures.caption': 'Signatures of this installation',
  'signatures.col.actions': 'Actions',
  'signatures.col.document': 'Document',
  'signatures.col.githubId': 'GitHub id',
  'signatures.col.signed': 'Signed',
  'signatures.col.signer': 'Signer',
  'signatures.col.source': 'Source',
  'signatures.col.status': 'Status',
  'signatures.col.version': 'Version',
  'signatures.count.one': '{count} signature on this page',
  'signatures.count.other': '{count} signatures on this page',
  'signatures.details': 'Details',
  'signatures.details.description':
    'What the signer gave when signing. The verified email address is shown here and nowhere else on this screen.',
  'signatures.details.email': 'Verified email',
  'signatures.details.label': 'Details of the signature of {signer}',
  'signatures.details.login': 'GitHub login',
  'signatures.details.name': 'Typed name',
  'signatures.details.revokedAt': 'Revoked',
  'signatures.details.revokedBy': 'Revoked by (GitHub id)',
  'signatures.details.revokedReason': 'Reason',
  'signatures.details.title': 'Signature of',
  'signatures.empty.filtered':
    'No signature matches this search. A login has to match exactly, in any case, and a text of digits is read as a GitHub id. Change the search or the filters.',
  'signatures.empty.none':
    'Nobody has signed a CLA document of this installation that you may read, or the signatures are not recorded yet.',
  'signatures.empty.title': 'No signatures found',
  'signatures.export': 'Export CSV',
  'signatures.export.choose': 'Choose a document to export its signatures.',
  'signatures.export.done': 'Saved as {name}.',
  'signatures.export.help':
    'Exports every signature of the chosen document that has the status chosen above. The search is not applied.',
  'signatures.export.notice':
    'The file contains personal data: the names, GitHub logins and email addresses of the signers. Keep it safe and share it only where you must.',
  'signatures.filter.document': 'Document',
  'signatures.filter.document.all': 'All documents',
  'signatures.filter.document.byId': 'Document {id}',
  'signatures.filter.document.repository': '{name} ({repository})',
  'signatures.filter.state': 'Status',
  'signatures.filter.state.all': 'All',
  'signatures.intro':
    'The signatures made in this installation: who signed, which version of which document, and where from. Revoking a signature applies to future pull requests only.',
  'signatures.notice.alreadyRevoked': 'That signature was already revoked. The list is up to date.',
  'signatures.notice.revoked': 'Signature revoked. Open pull requests that relied on it are checked again.',
  'signatures.results.title': 'Results',
  'signatures.revoke': 'Revoke',
  'signatures.revoke.confirm': 'Revoke signature',
  'signatures.revoke.description':
    'Revocation applies to future pull requests only; contributions already accepted stay licensed.',
  'signatures.revoke.label': 'Revoke the signature of {signer}',
  'signatures.revoke.reason': 'Reason',
  'signatures.revoke.reason.choose': 'Choose a reason',
  'signatures.revoke.reason.help': 'The reason is stored as a code. It cannot be changed afterwards.',
  'signatures.revoke.reason.legal_request': 'Legal request',
  'signatures.revoke.reason.maintainer_decision': 'Maintainer decision',
  'signatures.revoke.reason.other': 'Other',
  'signatures.revoke.reason.required': 'Choose a reason for the revocation.',
  'signatures.revoke.reason.signer_request': 'The signer asked for it',
  'signatures.revoke.title': 'Revoke the signature of',
  'signatures.search.field': 'Signer',
  'signatures.search.help':
    'Finds one signer by exact GitHub login, in any case, or by numeric GitHub id. A search of digits only is read as the id. A part of a login finds nothing.',
  'signatures.search.label': 'Search signatures',
  'signatures.signer.erased': 'Erased',
  'signatures.signer.erasedSubject': 'GitHub user {id}',
  'signatures.source.none': 'Not recorded',
  'signatures.source.pr': 'PR #{number}',
  'signatures.title': 'Signatures',
  'signatures.truncated':
    'Some repositories were left out of this search because too many of them have signatures. Choose a document to see all of its signatures.',
  'tenant.nav.signatures': 'Signatures',
} as const;
