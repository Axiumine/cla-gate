// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { summary, tenantOf } from '../installations/test-support.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { pendingKey } from './pending-queries.ts';
import {
  confirmRemoval,
  noContent,
  OVERRIDES_ROUTE,
  openOverrides,
  openPending,
  overrideOf,
  overridesPage,
  overridesTable,
  pathOf,
  removeButton,
  removeDialog,
  rowsOf,
  rule,
  UNLINKED_SHA,
} from './test-support.ts';

// E18-S08: removing an override: the alert dialog that warns that a green check may turn red, the DELETE addressed to the repository and
// the override of the row, the lists that are asked for again, and what a refusal does.

const SHORT = UNLINKED_SHA.slice(0, 7);
const ROUTE = `${OVERRIDES_ROUTE}&repository=1`;
const TWO = overridesPage([
  overrideOf({ id: 300 }),
  overrideOf({ id: 301, commitSha: 'b'.repeat(40), reason: 'Second' }),
]);
const cancel = () => within(removeDialog()).getByRole('button', { name: messages['common.cancel'] });
const results = () => screen.getByRole('heading', { level: 2, name: messages['pending.results.title'] });

test('Remove opens an alert dialog that names the commit, warns that a green check may turn red, and starts on Cancel', async () => {
  const { user } = await openOverrides(ROUTE);
  await user.click(removeButton(SHORT));
  const dialog = await screen.findByRole('alertdialog');
  expect(dialog).toHaveAccessibleName(`${messages['pending.overrides.remove.title']} ${SHORT}`);
  expect(dialog).toHaveAccessibleDescription(messages['pending.overrides.remove.description']);
  expect(messages['pending.overrides.remove.description']).toContain('green check');
  expect(messages['pending.overrides.remove.description']).toContain('red');
  expect(cancel()).toHaveFocus();
  expect(within(dialog).getByText(SHORT).tagName).toBe('CODE');
});

test('Escape does nothing, and Cancel closes the dialog with no request and puts focus back on the Remove button', async () => {
  const { served, user } = await openOverrides(ROUTE);
  await user.click(removeButton(SHORT));
  await screen.findByRole('alertdialog');
  await user.keyboard('{Escape}');
  expect(removeDialog()).toBeInTheDocument();
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(removeButton(SHORT)).toHaveFocus();
  expect(served.remove).toEqual([]);
});

test('Tab stays inside the dialog', async () => {
  const { user } = await openOverrides(ROUTE);
  await user.click(removeButton(SHORT));
  await screen.findByRole('alertdialog');
  for (let step = 0; step < 5; step += 1) {
    await user.tab();
    expect(removeDialog().contains(document.activeElement)).toBe(true);
  }
});

test('confirming sends a DELETE to the repository and the override of the row, with the CSRF header, asks for the list again, closes, and says so', async () => {
  const { served, user } = await openOverrides(ROUTE, {
    overrides: [TWO, overridesPage([overrideOf({ id: 301, commitSha: 'b'.repeat(40), reason: 'Second' })])],
  });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.remove.map((seen) => [seen.method, pathOf(seen)])).toEqual([
    ['DELETE', '/api/repositories/1/commit-overrides/300'],
  ]);
  expect(served.remove[0]?.headers['x-csrf-token']).toBeTruthy();
  expect(served.overrides).toHaveLength(2);
  expect(rowsOf(overridesTable()).map((cells) => cells[3])).toEqual(['Second']);
  expect(screen.getByText(messages['pending.overrides.notice.removed'])).toBeInTheDocument();
});

test('the row and its button are gone, so focus goes to the results heading', async () => {
  const { user } = await openOverrides(ROUTE, {
    overrides: [TWO, overridesPage([overrideOf({ id: 301, commitSha: 'b'.repeat(40) })])],
  });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  await waitFor(() => {
    expect(results()).toHaveFocus();
  });
});

test('removing the last override leaves the empty state, and focus is on the results heading', async () => {
  const { user } = await openOverrides(ROUTE, { overrides: [overridesPage([overrideOf()]), overridesPage([])] });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['pending.overrides.empty.title'] }),
  ).toBeInTheDocument();
  await waitFor(() => {
    expect(results()).toHaveFocus();
  });
});

test('the pending list is stale after a removal, because a green check may have turned red, and it is asked for again when the person returns to it', async () => {
  const { served, user, queryClient } = await openPending('/installations/5/pending');
  await user.click(screen.getByRole('tab', { name: messages['pending.tab.overrides'] }));
  await screen.findByRole('option', { name: 'acme/widgets' });
  await user.selectOptions(screen.getByRole('combobox', { name: /^Repository/ }), 'acme/widgets');
  await screen.findByRole('table', { name: messages['pending.overrides.caption'] });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(queryClient.getQueryCache().findAll({ queryKey: pendingKey(5) })[0]?.state.isInvalidated).toBe(true);
  await user.click(screen.getByRole('tab', { name: messages['pending.tab.pending'] }));
  await screen.findByRole('table', { name: messages['pending.caption'] });
  await waitFor(() => {
    expect(served.pending).toHaveLength(2);
  });
});

test('404 says the override was removed already, asks for the list again and closes the dialog', async () => {
  const { served, user } = await openOverrides(ROUTE, {
    overrides: [TWO, overridesPage([overrideOf({ id: 301, commitSha: 'b'.repeat(40) })])],
    remove: [envelope(404, 'not_found')],
  });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  expect(await screen.findByText(messages['pending.overrides.notice.gone'])).toBeInTheDocument();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(served.overrides).toHaveLength(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('403 is shown in the dialog as the forbidden state, which stays open, asks for nothing again, and Cancel closes it', async () => {
  const { served, user } = await openOverrides(ROUTE, { remove: [rule(403, 'forbidden')] });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  expect(await within(removeDialog()).findByRole('alert')).toHaveTextContent(messages['errors.forbidden']);
  expect(served.overrides).toHaveLength(1);
  expect(screen.queryByText(messages['pending.overrides.notice.removed'])).toBeNull();
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(rowsOf(overridesTable())).toHaveLength(1);
});

test('409 installation_suspended is told in the words of the catalog, in the dialog', async () => {
  const { user } = await openOverrides(ROUTE, { remove: [rule(409, 'installation_suspended')] });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  expect(await within(removeDialog()).findByRole('alert')).toHaveTextContent(
    messages['pending.rule.installation_suspended'],
  );
});

test('a 502 is the error state in the dialog with Try again, which sends the removal again and goes through', async () => {
  const { served, user } = await openOverrides(ROUTE, {
    overrides: [overridesPage([overrideOf()]), overridesPage([])],
    remove: [envelope(502, 'github_unavailable'), noContent()],
  });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  const alert = await within(removeDialog()).findByRole('alert');
  await user.click(within(alert).getByRole('button', { name: messages['states.retry'] }));
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.remove).toHaveLength(2);
  expect(screen.getByText(messages['pending.overrides.notice.removed'])).toBeInTheDocument();
});

test('a dialog opened again starts with no error of the attempt before', async () => {
  const { user } = await openOverrides(ROUTE, { remove: [envelope(502, 'github_unavailable')] });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  await within(removeDialog()).findByRole('alert');
  await user.click(cancel());
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  await user.click(removeButton(SHORT));
  await screen.findByRole('alertdialog');
  expect(within(removeDialog()).queryByRole('alert')).toBeNull();
});

test('the dialog stays open while the request is out, Cancel does not close it, and a second confirm sends no second request', async () => {
  // The request is held until the checks of the open state are done: a delay would end first on a slow machine.
  const held = Promise.withResolvers<true>();
  const { served, user } = await openOverrides(ROUTE, {
    remove: [
      async () => {
        await held.promise;
        return noContent();
      },
    ],
    overrides: [overridesPage([overrideOf()]), overridesPage([])],
  });
  await user.click(removeButton(SHORT));
  await user.click(confirmRemoval());
  await user.click(confirmRemoval());
  await user.click(cancel());
  expect(confirmRemoval()).toHaveAttribute('aria-busy', 'true');
  expect(removeDialog()).toBeInTheDocument();
  held.resolve(true);
  await waitFor(() => {
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
  expect(served.remove).toHaveLength(1);
});

test('on a suspended installation the Remove buttons are off', async () => {
  await openOverrides(ROUTE, { tenants: [tenantOf(summary({ suspended: true }), 'acme/widgets', 'acme/gadgets')] });
  expect(removeButton(SHORT)).toBeDisabled();
});

test('the removal dialog passes axe, open and with a refusal', async () => {
  const { user } = await openOverrides(ROUTE, { remove: [rule(403, 'forbidden')] });
  await user.click(removeButton(SHORT));
  await screen.findByRole('alertdialog');
  await expectNoA11yViolations(document.body);
  await user.click(confirmRemoval());
  await within(removeDialog()).findByRole('alert');
  await expectNoA11yViolations(document.body);
});
