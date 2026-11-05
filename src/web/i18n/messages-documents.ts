// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The messages of the CLA document screens (E18-S05): the list, the new-document dialog, the editor and the publish dialog. They are
 * a catalog of their own so that the main catalog stays under the size cap, and the main catalog spreads them in; the rules of
 * `messages.ts` hold for every key here (a dotted key, a `{name}` placeholder, a `.one` with its `.other`).
 */
export const documentMessages = {
  'document.facts.draft': 'Draft',
  'document.facts.kind': 'Kind',
  'document.facts.noDraft': 'No draft saved',
  'document.facts.scope': 'Scope',
  'document.facts.version': 'Active version',
  'document.tabs.editor': 'Editor',
  'document.tabs.label': 'Parts of the document',
  'document.title': 'CLA document',
  'documents.caption': 'CLA documents of this installation',
  'documents.col.draft': 'Draft',
  'documents.col.kind': 'Kind',
  'documents.col.name': 'Name',
  'documents.col.scope': 'Scope',
  'documents.col.version': 'Active version',
  'documents.draftSaved': 'Draft saved',
  'documents.empty.description':
    'Create a document, write or paste your own agreement text in the editor, and publish it. This platform ships with no legal text.',
  'documents.empty.title': 'No CLA documents yet',
  'documents.intro':
    'A document holds the text contributors sign. You write or paste your own text and publish it as a version; nothing is provided.',
  'documents.kind.corporate': 'Corporate',
  'documents.kind.individual': 'Individual',
  'documents.new': 'New document',
  'documents.new.description':
    'The document starts empty. You write its text in the editor and publish it when it is ready.',
  'documents.new.kind': 'Kind',
  'documents.new.moreRepositories':
    'Only the first {count} repositories are listed. A document of another repository is made from that repository.',
  'documents.new.name': 'Name',
  'documents.new.nameHelp': 'A name of 1 to 100 characters.',
  'documents.new.scope': 'Scope',
  'documents.new.scopeHelp':
    'A document of the whole installation is managed by organisation admins; one of a repository by that repository’s admins.',
  'documents.new.scopeInstallation': 'The whole installation',
  'documents.new.submit': 'Create document',
  'documents.new.title': 'New CLA document',
  'documents.rule.content_empty': 'The text is empty. Write the agreement before you save.',
  'documents.rule.content_invalid_characters':
    'The text has a character that cannot be stored: a control character other than tab and line break, or half of a character pair.',
  'documents.rule.content_too_deeply_nested':
    'Block quotes or lists are nested too deeply. Flatten them and save again.',
  'documents.rule.content_too_large': 'The text is too large: {actual} bytes, and the limit is {limit}.',
  'documents.rule.content_unchanged':
    'The text is the same as the active version. Choose major to ask everyone to sign again, or change the text first.',
  'documents.rule.document_limit_reached':
    'This installation already has the most documents it can hold. Rename or reuse one of them.',
  'documents.rule.document_name_taken': 'Another document of this installation already has this name.',
  'documents.rule.first_version_must_be_major': 'The first version of a document must be a major one.',
  'documents.rule.invalid_name':
    'Enter a name of 1 to 100 characters, with no control characters and no characters that change the text direction.',
  'documents.rule.invalid_rationale': 'Describe the change in 1 to 2000 characters, with no control characters.',
  'documents.rule.kind_not_supported': 'This kind of document cannot be created yet.',
  'documents.rule.version_conflict':
    'Another version was published at the same moment. Load the latest version and try again.',
  'documents.scope.installation': 'Whole installation',
  'documents.scope.repository': 'One repository',
  'documents.title': 'CLA documents',
  'documents.version.none': 'Not published',
  'editor.conflict.load': 'Load latest',
  'editor.conflict.message':
    'Another admin saved this draft while you were editing. Your text is still here and has not been saved. Load the latest draft to replace your text with theirs.',
  'editor.conflict.title': 'The draft changed',
  'editor.discard': 'Discard draft',
  'editor.discard.confirm': 'Discard draft',
  'editor.discard.description':
    'The saved draft is deleted for every admin of this document, and so are the changes you have not saved. The editor goes back to the active version.',
  'editor.discard.title': 'Discard this draft?',
  'editor.discarded': 'Draft discarded. The editor shows the active version.',
  'editor.leave.confirm': 'Leave without saving',
  'editor.leave.description': 'The changes you made to the text are not saved. If you leave, they are lost.',
  'editor.leave.stay': 'Stay',
  'editor.leave.title': 'Leave without saving?',
  'editor.loaded': 'The latest draft is loaded.',
  'editor.loadedActive': 'The latest version is loaded. You can publish again.',
  'editor.preview.empty': 'There is nothing to preview yet.',
  'editor.preview.note': 'This is how contributors read the text.',
  'editor.preview.title': 'Preview',
  'editor.publish': 'Publish',
  'editor.published.resign':
    'Contributors must sign this version, and the checks on open pull requests will be evaluated again.',
  'editor.published.same': 'Existing signatures stay valid.',
  'editor.published.title': 'Version {version} is now the active version',
  'editor.save': 'Save draft',
  'editor.saved': 'Draft saved.',
  'editor.stale.load': 'Load latest',
  'editor.stale.message':
    'Another admin published a version while you were working. Your draft is still here. Load the latest version, then publish again.',
  'editor.stale.title': 'A newer version was published',
  'editor.text.label': 'CLA text (Markdown)',
  'editor.text.size': '{size} of {limit} bytes',
  'editor.text.sizeOver': '{size} of {limit} bytes: over the limit',
  'publish.bump': 'Kind of change',
  'publish.bump.first': 'This is the first version of the document, so it is a major version.',
  'publish.bump.major': 'Major: everyone must sign again',
  'publish.bump.minor': 'Minor: a clarification or a typo; existing signatures stay valid',
  'publish.description': 'Publishing makes the saved draft the text contributors sign.',
  'publish.hash': 'SHA-256 of the text',
  'publish.hash.failed': 'This browser cannot compute the hash. The server records it when the version is published.',
  'publish.hash.pending': 'Computing the hash',
  'publish.immutable':
    'A published version is immutable: it cannot be edited or deleted. A mistake is fixed by publishing a new version.',
  'publish.rationale': 'What changed',
  'publish.rationaleHelp':
    'Required, 1 to 2000 characters. Contributors read it when they are asked to sign the new version.',
  'publish.resign.confirm': 'I understand that these contributors must sign again',
  'publish.resign.message.one': '{count} contributor has signed the current major version and must sign again.',
  'publish.resign.message.other': '{count} contributors have signed the current major version and must sign again.',
  'publish.resign.title': 'Contributors must sign again',
  'publish.result': 'Resulting version',
  'publish.result.note': 'Shown for information: the server numbers the version.',
  'publish.result.value': 'Version {version}',
  'publish.saveFirst':
    'Save your draft first. A version is made from the saved draft, and the text in the editor has not been saved yet.',
  'publish.submit': 'Publish version',
  'publish.title': 'Publish a version',
  'tenant.nav.documents': 'CLA documents',
  'tenant.nav.label': 'Parts of this installation',
  'tenant.nav.overview': 'Overview',
} as const;
