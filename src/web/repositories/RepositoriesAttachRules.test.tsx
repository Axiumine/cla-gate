// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { json } from '../api/test-support.ts';
import { held } from '../documents/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  attachButton,
  attachDialog,
  attachedAs,
  changeButton,
  documentSelect,
  documentsOf,
  gadgets,
  installationDocument,
  openRepositories,
  pageOf,
  repositoryDocument,
  rule,
  saveButton,
  widgets,
} from './test-support.ts';

// E18-S10: what an attach that is refused does. The four rules of the API with words of their own are alerts in the dialog, which stays
// open with the choice; a 403 is the forbidden state; anything else is the error state with Try again where it can help. Nothing is
// optimistic: the list is not asked for again after a refusal.

async function attempt(serve: Parameters<typeof openRepositories>[1], repository = 'acme/gadgets', choose = '11') {
  const opened = await openRepositories(undefined, serve);
  await opened.user.click(repository === 'acme/gadgets' ? attachButton(repository) : changeButton(repository));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  await opened.user.selectOptions(documentSelect(), choose);
  await opened.user.click(saveButton());
  return opened;
}

const alertOf = () => within(attachDialog()).findByRole('alert');

test.each([
  [
    '422 document_not_attachable',
    422,
    'document_not_attachable',
    messages['repositories.rule.document_not_attachable'],
  ],
  ['409 document_unpublished', 409, 'document_unpublished', messages['repositories.rule.document_unpublished']],
  ['409 installation_suspended', 409, 'installation_suspended', messages['repositories.rule.installation_suspended']],
])(
  '%s is told in the words of the catalog, the dialog stays open with the choice, and the list is not asked for again',
  async (_what, status, code, text) => {
    const { served } = await attempt({ attach: [rule(status, code)] });
    expect(await alertOf()).toHaveTextContent(text);
    expect(attachDialog()).toBeInTheDocument();
    expect(documentSelect()).toHaveValue('11');
    expect(served.list).toHaveLength(1);
    expect(screen.queryByText(/^A CLA is attached/)).toBeNull();
  },
);

test('409 repository_enabled on a detach says the check has to be off first', async () => {
  const { served } = await attempt({ attach: [rule(409, 'repository_enabled')] }, 'acme/widgets', 'none');
  expect(await alertOf()).toHaveTextContent(messages['repositories.rule.repository_enabled']);
  expect(documentSelect()).toHaveValue('none');
  expect(served.list).toHaveLength(1);
});

test('409 document_unpublished links to the editor of the chosen document, and the link leaves for the editor of that document', async () => {
  const { user } = await attempt({ attach: [rule(409, 'document_unpublished')] });
  const link = await within(attachDialog()).findByRole('link', { name: messages['repositories.editor'] });
  expect(link).toHaveAttribute('href', '/installations/5/documents/11');
  await user.click(link);
  await waitFor(() => {
    expect(window.location.pathname).toBe('/installations/5/documents/11');
  });
});

test("a repo admin who is refused a document of the repository is sent to its editor, and one who is refused the installation's document is sent nowhere", async () => {
  const repoAdmin = [{ summary: summary({ role: 'repo_admin' }), answer: () => pageOf([]) }];
  const own = await attempt(
    {
      tenants: repoAdmin,
      documents: [documentsOf({ repositoryScoped: [repositoryDocument(21, 'Gadgets CLA', null)] })],
      attach: [rule(409, 'document_unpublished')],
    },
    'acme/gadgets',
    '21',
  );
  expect(await within(attachDialog()).findByRole('link', { name: messages['repositories.editor'] })).toHaveAttribute(
    'href',
    '/installations/5/documents/21',
  );
  own.unmount();
  await attempt(
    {
      tenants: repoAdmin,
      documents: [documentsOf({ installationScoped: [installationDocument(12, 'Draft', null)] })],
      attach: [rule(409, 'document_unpublished')],
    },
    'acme/gadgets',
    '12',
  );
  expect(await alertOf()).toHaveTextContent(messages['repositories.rule.document_unpublished']);
  expect(within(attachDialog()).queryByRole('link')).toBeNull();
});

test('choosing another document takes the refusal away, because it was about the earlier choice', async () => {
  const { user } = await attempt({ attach: [rule(422, 'document_not_attachable')] });
  await alertOf();
  await user.selectOptions(documentSelect(), 'none');
  expect(within(attachDialog()).queryByRole('alert')).toBeNull();
});

test('reopening the dialog forgets the refusal of the last time', async () => {
  const { user } = await attempt({ attach: [rule(422, 'document_not_attachable')] });
  await alertOf();
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  await user.click(attachButton('acme/gadgets'));
  await screen.findByRole('combobox', { name: messages['repositories.attach.field'] });
  expect(within(attachDialog()).queryByRole('alert')).toBeNull();
});

test('a 403 keeps the dialog open with the forbidden state and no Try again, because asking again does not change it', async () => {
  const { served } = await attempt({ attach: [rule(403, 'forbidden')] });
  const alert = await alertOf();
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(attachDialog()).toBeInTheDocument();
  expect(served.list).toHaveLength(1);
});

test('GitHub being down is the error state with Try again, which sends the same request again, and the dialog closes when it goes through', async () => {
  const { served, user } = await attempt({
    attach: [rule(502, 'github_unavailable'), attachedAs(11)],
    list: [pageOf([widgets(), gadgets()]), pageOf([widgets(), gadgets()])],
  });
  expect(await alertOf()).toHaveTextContent(messages['errors.github_unavailable']);
  await user.click(within(attachDialog()).getByRole('button', { name: messages['states.retry'] }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(served.attach).toHaveLength(2);
});

test('limited by GitHub (503) is the error state with the countdown, and the dialog stays open', async () => {
  await attempt({
    attach: [
      json({ error: { code: 'github_rate_limited', message: 'x', requestId: 'req-00000001' } }, 503, {
        'retry-after': '30',
      }),
    ],
  });
  expect(await alertOf()).toHaveTextContent(messages['errors.github_rate_limited']);
  expect(attachDialog()).toBeInTheDocument();
});

test('an attach refused with 409 installation_suspended asks for the list of installations again, whose flag turns on the banner and turns the buttons off', async () => {
  let asked = 0;
  const { served, user } = await attempt({
    attach: [rule(409, 'installation_suspended')],
    listing: () => {
      asked += 1;
      return json([summary({ suspended: asked > 1 })]);
    },
  });
  await alertOf();
  await waitFor(() => {
    expect(served.tenants.list).toHaveLength(2);
  });
  expect(await screen.findByText(messages['installation.suspended'])).toBeInTheDocument();
  expect(saveButton()).toBeEnabled();
  await user.click(within(attachDialog()).getByRole('button', { name: messages['common.close'] }));
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  expect(attachButton('acme/gadgets')).toBeDisabled();
  expect(changeButton('acme/widgets')).toBeDisabled();
});

test('the refusal passes axe', async () => {
  await attempt({ attach: [rule(409, 'document_unpublished')] });
  await alertOf();
  await expectNoA11yViolations(document.body);
});

test('a document chosen while the request is out does not lock the dialog: the next save is sent, and the answer to the first one is dropped', async () => {
  const gate = held(rule(409, 'document_unpublished'));
  const { served, user } = await attempt({ attach: [gate.answer, attachedAs(null)] });
  await waitFor(() => {
    expect(served.attach).toHaveLength(1);
  });
  await user.selectOptions(documentSelect(), 'none');
  gate.release();
  await waitFor(() => {
    expect(saveButton()).not.toHaveAttribute('aria-busy', 'true');
  });
  expect(within(attachDialog()).queryByRole('alert')).toBeNull();
  await user.click(saveButton());
  await waitFor(() => {
    expect(served.attach).toHaveLength(2);
  });
});
