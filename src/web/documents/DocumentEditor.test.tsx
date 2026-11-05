// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { globex, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  ACTIVE_TEXT,
  detailOf,
  draftOf,
  EDITOR_ROUTE,
  editorField,
  heading,
  listedOf,
  openEditor,
  renderDocuments,
  serveDocuments,
  unpublished,
} from './test-support.ts';

// E18-S05: the editor of one document at /installations/$installationId/documents/$documentId: what it opens with, the size against
// the limit, the live preview, and what it keeps out of the browser's storage.

afterEach(() => {
  vi.restoreAllMocks();
});

test('with a saved draft the editor opens on the text of the draft, says a draft is saved, and offers to discard it', async () => {
  const { served } = await openEditor({ draft: [draftOf('The text of the draft', 3)] });
  expect(editorField()).toHaveValue('The text of the draft');
  const facts = screen.getByText(messages['document.facts.draft']).closest('dl');
  expect(facts).toHaveTextContent(messages['documents.draftSaved']);
  expect(screen.getByRole('button', { name: messages['editor.discard'] })).toBeInTheDocument();
  expect(served.version).toHaveLength(1);
});

test('with no draft the editor opens on the text of the active version, which is read by its id', async () => {
  const { served } = await openEditor();
  expect(editorField()).toHaveValue(ACTIVE_TEXT);
  expect(served.version.map((seen) => new URL(seen.url).pathname)).toEqual([
    '/api/installations/5/documents/11/versions/301',
  ]);
  const facts = screen.getByText(messages['document.facts.draft']).closest('dl');
  expect(facts).toHaveTextContent(messages['document.facts.noDraft']);
  expect(screen.queryByRole('button', { name: messages['editor.discard'] })).toBeNull();
});

test('a document with no version and no draft opens empty, and asks for no version text', async () => {
  const served = serveDocuments({ detail: [detailOf(unpublished())] });
  renderDocuments(EDITOR_ROUTE);
  await heading('Individual CLA');
  expect(editorField()).toHaveValue('');
  expect(served.version).toEqual([]);
  expect(screen.getByText(messages['editor.preview.empty'])).toBeInTheDocument();
  expect(screen.getByText(messages['documents.version.none'])).toBeInTheDocument();
});

test('the editor asks for the document, its draft and the version text of this tenant and this document, and nothing else', async () => {
  const { served } = await openEditor();
  const paths = [...served.detail, ...served.draft, ...served.version].map((seen) => [
    seen.method,
    new URL(seen.url).pathname,
  ]);
  expect(paths).toEqual([
    ['GET', '/api/installations/5/documents/11'],
    ['GET', '/api/installations/5/documents/11/draft'],
    ['GET', '/api/installations/5/documents/11/versions/301'],
  ]);
});

test('the h1 is the name of the document, the facts say its scope, kind and active version, and there is one tab, "Editor"', async () => {
  serveDocuments({
    detail: [detailOf(listedOf({ scope: 'repository', repositoryId: 7, repositoryFullName: 'acme/widgets' }))],
  });
  renderDocuments(EDITOR_ROUTE);
  await heading('Individual CLA');
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  const facts = screen.getByText(messages['document.facts.scope']).closest('dl');
  expect(facts).toHaveTextContent(messages['documents.scope.repository']);
  expect(facts).toHaveTextContent(messages['documents.kind.individual']);
  expect(facts).toHaveTextContent('1.0');
  const tabs = within(screen.getByRole('tablist', { name: messages['document.tabs.label'] })).getAllByRole('tab');
  expect(tabs.map((tab) => tab.textContent)).toEqual([messages['document.tabs.editor']]);
  expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
});

test('the text field is a monospace textarea with a label, and the size is shown against the limit of 204,800 bytes', async () => {
  await openEditor({ draft: [draftOf('abc', 1)] });
  const field = editorField();
  expect(field.tagName).toBe('TEXTAREA');
  expect(field).toHaveClass('font-mono');
  expect(field).toHaveAccessibleDescription('4 of 204,800 bytes');
});

test('the size counts the UTF-8 bytes of the canonical text and follows the typing', async () => {
  const { user } = await openEditor({ draft: [draftOf('abc', 1)] });
  await user.clear(editorField());
  await user.paste('€€');
  expect(editorField()).toHaveAccessibleDescription('7 of 204,800 bytes');
  await user.clear(editorField());
  expect(editorField()).toHaveAccessibleDescription('0 of 204,800 bytes');
});

test('a text over the limit says so, and the editor does not stop the person from saving: the server decides', async () => {
  await openEditor({ draft: [draftOf('€'.repeat(70_000), 1)] });
  expect(editorField()).toHaveAccessibleDescription('210,001 of 204,800 bytes: over the limit');
  expect(screen.getByRole('button', { name: messages['editor.publish'] })).toBeEnabled();
});

test('the preview shows the text as the sign page does, with a heading under the h2 of the preview, and follows the typing', async () => {
  const { user } = await openEditor({ draft: [draftOf('# Grant of rights\n\nYou **grant** a licence.', 1)] });
  const preview = screen.getByRole('region', { name: messages['editor.preview.title'] });
  expect(
    within(preview).getByRole('heading', { level: 2, name: messages['editor.preview.title'] }),
  ).toBeInTheDocument();
  expect(within(preview).getByRole('heading', { level: 3, name: 'Grant of rights' })).toBeInTheDocument();
  expect(within(preview).getByText('grant').tagName).toBe('STRONG');
  await user.clear(editorField());
  await user.paste('# Changed');
  expect(await within(preview).findByRole('heading', { level: 3, name: 'Changed' })).toBeInTheDocument();
  expect(within(preview).queryByText('Grant of rights')).toBeNull();
});

test('an empty text shows "nothing to preview yet" and a text of spaces does too', async () => {
  const { user } = await openEditor({ draft: [draftOf('   \n', 1)] });
  expect(screen.getByText(messages['editor.preview.empty'])).toBeInTheDocument();
  await user.clear(editorField());
  await user.paste('Some text');
  const preview = screen.getByRole('region', { name: messages['editor.preview.title'] });
  expect(await within(preview).findByText('Some text')).toBeInTheDocument();
  expect(screen.queryByText(messages['editor.preview.empty'])).toBeNull();
});

test('nothing of the text, the draft or the rationale is written to Web Storage, not while typing and not when saving', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem');
  const { user } = await openEditor();
  await user.clear(editorField());
  await user.paste('Typed and saved text');
  await user.click(screen.getByRole('button', { name: messages['editor.save'] }));
  expect(await screen.findByText(messages['editor.saved'], { selector: '[role="status"]' })).toBeInTheDocument();
  expect(setItem).not.toHaveBeenCalled();
  expect(localStorage).toHaveLength(0);
  expect(sessionStorage).toHaveLength(0);
});

test('a suspended installation can be read and not changed: the text is read only and nothing writes', async () => {
  const suspended = {
    ...tenantOf(globex({ id: 5, accountLogin: 'acme', role: 'org_admin', suspended: true }), 'acme/widgets'),
  };
  await openEditor({ tenants: [suspended] });
  expect(editorField()).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: messages['editor.save'] })).toBeDisabled();
  expect(screen.getByRole('button', { name: messages['editor.publish'] })).toBeDisabled();
});

test.each(['abc', '0', '-3', '1e3', '0x10', '1.5', '007'])(
  'the address with the document %j is no page of the app and asks for nothing',
  async (id) => {
    const served = serveDocuments();
    renderDocuments(`/installations/5/documents/${id}`);
    expect(await heading(messages['states.notFound.title'])).toBeInTheDocument();
    expect([...served.detail, ...served.draft, ...served.version]).toEqual([]);
  },
);

test.each([
  [403, 'forbidden', messages['states.forbidden.title']],
  [404, 'not_found', messages['states.error.title']],
])('a %d for the document is the error state with nothing of the document on screen', async (status, code, title) => {
  serveDocuments({ detail: [envelope(status, code)] });
  renderDocuments(EDITOR_ROUTE);
  expect(await heading(title)).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('tablist')).toBeNull();
});

test('a failed read of the draft is the error state, retried with "Try again", and the editor opens when it works', async () => {
  serveDocuments({ draft: [envelope(502, 'github_unavailable'), draftOf('Second try', 2)] });
  const { user } = renderDocuments(EDITOR_ROUTE);
  await screen.findByRole('alert');
  expect(screen.queryByRole('textbox')).toBeNull();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  await heading('Individual CLA');
  expect(editorField()).toHaveValue('Second try');
});

test('the editor, with a draft saved, passes axe', async () => {
  await openEditor({ draft: [draftOf('# Title\n\nBody text.', 2)] });
  await expectNoA11yViolations(document.body);
});
