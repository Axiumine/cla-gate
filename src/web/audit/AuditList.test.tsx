// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import { assert, expect, test } from 'vitest';
import { envelope } from '../api/test-support.ts';
import { messages } from '../i18n/index.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import {
  AUDIT_ROUTE,
  auditTable,
  bodyRows,
  eventOf,
  metadataButton,
  openAudit,
  pageOf,
  paramsOf,
  pathOf,
  renderAudit,
  rowsOf,
  serveAudit,
  systemEventOf,
} from './test-support.ts';

// E18-S09: the audit list: what a row shows, how an action, an actor and a subject are told, the metadata block, and the states.

test('the log is asked for through the installation in the path, 50 at a time, with no filter', async () => {
  const { served } = await openAudit();
  expect(served.log.map(pathOf)).toEqual(['/api/installations/5/audit-log']);
  expect(paramsOf(served.log[0])).toEqual({ limit: '50' });
});

test('a row shows the time in UTC with its event number, the actor, the label of the action, and the subject', async () => {
  await openAudit();
  expect(rowsOf(auditTable()).map((cells) => cells.slice(0, 4))).toEqual([
    ['2026-11-04 10:15 UTCEvent 12', '4711 octocat', 'Signature revoked', 'signature 9'],
    ['2026-11-03 08:00 UTCEvent 11', 'System', 'Installation suspended on GitHub', 'installation 5'],
  ]);
  const [first] = bodyRows(auditTable());
  assert.isDefined(first);
  expect(within(first).getByRole('time')).toHaveAttribute('datetime', '2026-11-04T10:15:30.123Z');
});

test('the actor id and the subject id are in code, and the login is text next to the id', async () => {
  await openAudit();
  const [first] = bodyRows(auditTable());
  assert.isDefined(first);
  const codes = [...first.querySelectorAll('code')].map((code) => code.textContent);
  expect(codes).toEqual(['4711', '9']);
});

test('an event no person caused has no actor and says System, without a code for it', async () => {
  await openAudit(AUDIT_ROUTE, { log: [pageOf([systemEventOf()])] });
  const [cells] = rowsOf(auditTable());
  expect(cells?.[1]).toBe(messages['audit.actor.system']);
  const [row] = bodyRows(auditTable());
  assert.isDefined(row);
  expect(within(row).getByText(messages['audit.actor.system']).closest('code')).toBeNull();
});

test('an actor whose login the instance does not hold is the id alone', async () => {
  await openAudit(AUDIT_ROUTE, { log: [pageOf([eventOf({ actor: { githubId: 4711, login: null } })])] });
  expect(rowsOf(auditTable())[0]?.[1]).toBe('4711');
});

test('an event about no record says None for its subject', async () => {
  await openAudit(AUDIT_ROUTE, { log: [pageOf([eventOf({ subject: null })])] });
  expect(rowsOf(auditTable())[0]?.[3]).toBe(messages['audit.subject.none']);
});

test('an action the catalogue does not know is shown raw in code, and one it knows has its label and no code', async () => {
  await openAudit(AUDIT_ROUTE, {
    log: [pageOf([eventOf({ id: 20, action: 'billing.exploded' }), eventOf({ id: 19, action: 'signature.created' })])],
  });
  const [unknown, known] = bodyRows(auditTable());
  assert.isDefined(unknown);
  assert.isDefined(known);
  expect(within(unknown).getByText('billing.exploded').closest('code')).not.toBeNull();
  expect(within(known).getByText(messages['audit.action.signature.created']).closest('code')).toBeNull();
  expect(within(known).queryByText('signature.created')).toBeNull();
});

test('the events come in the order the server gave them, newest first', async () => {
  await openAudit(AUDIT_ROUTE, {
    log: [pageOf([eventOf({ id: 3 }), eventOf({ id: 2 }), eventOf({ id: 1 })])],
  });
  expect(rowsOf(auditTable()).map((cells) => cells[0]?.slice(-1))).toEqual(['3', '2', '1']);
});

test('the number of events on the page is announced in a polite live region', async () => {
  await openAudit();
  const status = await screen.findByText('2 events on this page');
  expect(status).toHaveAttribute('role', 'status');
  expect(status).toHaveAttribute('aria-live', 'polite');
});

test('an event with metadata has a button that opens it, named after the event; one without says None and has no button', async () => {
  await openAudit();
  const rows = rowsOf(auditTable());
  expect(rows[0]?.[4]).toBe(messages['audit.metadata.show']);
  expect(rows[1]?.[4]).toBe(messages['audit.metadata.none']);
  expect(metadataButton(12)).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: /event 11/ })).toBeNull();
});

test('opened, the metadata is the key-sorted object as text in a pre, and closing it takes the block away', async () => {
  const { user } = await openAudit();
  await user.click(metadataButton(12));
  const button = screen.getByRole('button', { name: messages['audit.metadata.hideLabel'].replace('{id}', '12') });
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(button).toHaveTextContent(messages['audit.metadata.hide']);
  const block = document.getElementById(String(button.getAttribute('aria-controls')));
  expect(block?.tagName).toBe('PRE');
  expect(block?.textContent).toBe('{\n  "reason_code": "legal_request",\n  "signature_id": 9\n}');
  await user.click(button);
  expect(document.getElementById(block?.id ?? '')).toBeNull();
  expect(metadataButton(12)).toHaveAttribute('aria-expanded', 'false');
  expect(metadataButton(12)).not.toHaveAttribute('aria-controls');
});

test('two rows open their metadata independently', async () => {
  const { user } = await openAudit(AUDIT_ROUTE, {
    log: [pageOf([eventOf({ id: 2, metadata: { count: 2 } }), eventOf({ id: 1, metadata: { count: 1 } })])],
  });
  await user.click(metadataButton(1));
  expect(screen.getAllByText(/"count"/)).toHaveLength(1);
  await user.click(metadataButton(2));
  expect(screen.getAllByText(/"count"/)).toHaveLength(2);
});

test('the title of the tab names the screen and the account', async () => {
  await openAudit();
  await waitFor(() => {
    expect(document.title).toBe('Audit log: acme · CLA');
  });
});

test('the page has one h1, then the results as h2', async () => {
  await openAudit();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 2, name: messages['audit.results.title'] })).toBeInTheDocument();
});

test('the list passes axe, and so does the page with a metadata block open', async () => {
  const { user, container } = await openAudit();
  await expectNoA11yViolations(container);
  await user.click(metadataButton(12));
  await expectNoA11yViolations(container);
});

test('a log with no event says nothing was recorded yet, and has no table or pager', async () => {
  serveAudit({ log: [pageOf([])] });
  renderAudit(AUDIT_ROUTE);
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['audit.empty.none.title'] }),
  ).toBeInTheDocument();
  expect(screen.getByText(messages['audit.empty.none.description'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('navigation', { name: messages['pager.label'] })).toBeNull();
});

test('while the first page is on its way the screen is loading, with no table', async () => {
  serveAudit({ log: [() => new Promise<Response>(() => undefined)] });
  renderAudit(AUDIT_ROUTE);
  expect(await screen.findByText(messages['states.loading'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: messages['audit.title'] })).toBeInTheDocument();
});

test('a 403 (a repo admin) is the forbidden state and no row, with no way to try again', async () => {
  serveAudit({ log: [envelope(403, 'forbidden')] });
  renderAudit(AUDIT_ROUTE);
  expect(
    await screen.findByRole('heading', { level: 3, name: messages['states.forbidden.title'] }),
  ).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
  expect(screen.queryByRole('button', { name: messages['states.retry'] })).toBeNull();
});

test('a server error on the first page is the error state with "Try again", which asks again', async () => {
  const served = serveAudit({ log: [envelope(500, 'internal_server_error'), pageOf([eventOf()])] });
  const { user } = renderAudit(AUDIT_ROUTE);
  expect(await screen.findByText(messages['errors.internal_server_error'])).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: messages['audit.empty.none.title'] })).toBeNull();
  await user.click(screen.getByRole('button', { name: messages['states.retry'] }));
  await screen.findByRole('table', { name: messages['audit.caption'] });
  expect(served.log).toHaveLength(2);
});

test('the uniform 404 of a tenant that is not the person is the not-found state, with the request id and no row', async () => {
  serveAudit({ log: [envelope(404, 'not_found')] });
  renderAudit(AUDIT_ROUTE);
  expect(await screen.findByText(messages['errors.not_found'])).toBeInTheDocument();
  expect(screen.getByText(messages['states.requestId'])).toBeInTheDocument();
  expect(screen.queryByRole('table')).toBeNull();
});
