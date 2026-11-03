// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, within } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Badge } from './Badge.tsx';
import { DataTable } from './DataTable.tsx';
import { type DataColumn, nextSort, type TableSort } from './data-table-columns.ts';

// E17-S10: DataTable, a semantic table whose user text goes through UserText.

interface Person {
  readonly id: string;
  readonly login: string;
  readonly signatures: number;
  readonly active: boolean;
}

const ROWS: readonly Person[] = [
  { id: '1', login: 'octocat', signatures: 3, active: true },
  { id: '2', login: 'hubot', signatures: 0, active: false },
];

const COLUMNS: readonly DataColumn<Person>[] = [
  { id: 'login', header: 'Login', userText: (row) => row.login, sortable: true },
  { id: 'signatures', header: 'Signatures', render: (row) => row.signatures, sortable: true },
  { id: 'status', header: 'Status', render: (row) => <Badge status={row.active ? 'active' : 'revoked'} /> },
  { id: 'note', header: 'Note', render: () => null },
];

const table = () => screen.getByRole('table', { name: 'Signers' });
const headerOf = (name: string) => screen.getByRole('columnheader', { name });

function Signers({
  sort,
}: {
  readonly sort?: { current: TableSort | undefined; onChange: (sort: TableSort) => void };
}) {
  return (
    <DataTable caption="Signers" columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} {...(sort ? { sort } : {})} />
  );
}

test('it is a table named by its caption, with one column heading per column and one row per row', () => {
  renderWithProviders(<Signers />);
  expect(
    within(table())
      .getAllByRole('columnheader')
      .map((heading) => heading.textContent),
  ).toEqual(['Login', 'Signatures', 'Status', 'Note']);
  for (const heading of within(table()).getAllByRole('columnheader')) {
    expect(heading).toHaveAttribute('scope', 'col');
  }
  const rows = within(table()).getAllByRole('row');
  expect(rows).toHaveLength(3);
  expect(
    within(rows[1] ?? table())
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['octocat', '3', 'Active', '']);
  expect(
    within(rows[2] ?? table())
      .getAllByRole('cell')
      .map((cell) => cell.textContent),
  ).toEqual(['hubot', '0', 'Revoked', '']);
});

test('the caption is for assistive technology unless it is asked for, and then it is shown', () => {
  const { rerender } = renderWithProviders(<Signers />);
  const caption = () => within(table()).getByText('Signers');
  expect(caption().tagName).toBe('CAPTION');
  expect(caption()).toHaveClass('sr-only');
  rerender(<DataTable caption="Signers" captionVisible columns={COLUMNS} rows={ROWS} rowKey={(row) => row.id} />);
  expect(caption()).not.toHaveClass('sr-only');
});

test('a userText column shows its text through UserText and a render column shows what it returns', () => {
  renderWithProviders(<Signers />);
  const login = screen.getByText('octocat');
  expect(login.tagName).toBe('BDI');
  expect(login.closest('td')).toBe(within(table()).getAllByRole('cell')[0]);
  expect(screen.getByText('3').tagName).toBe('TD');
  expect(screen.getByText('Active')).toHaveAttribute('data-status', 'active');
});

test('without a sort, or on a column that is not sortable, a heading is plain text and has no aria-sort', () => {
  const { rerender } = renderWithProviders(<Signers />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(headerOf('Login')).not.toHaveAttribute('aria-sort');
  rerender(<Signers sort={{ current: { columnId: 'note', direction: 'ascending' }, onChange: vi.fn() }} />);
  expect(headerOf('Note')).not.toHaveAttribute('aria-sort');
  expect(within(headerOf('Status')).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Login', 'Signatures']);
});

test('the heading the rows are sorted by says so with aria-sort and an arrow, and the others say nothing', () => {
  const { rerender } = renderWithProviders(
    <Signers sort={{ current: { columnId: 'signatures', direction: 'descending' }, onChange: vi.fn() }} />,
  );
  expect(headerOf('Signatures')).toHaveAttribute('aria-sort', 'descending');
  expect(headerOf('Signatures')).toHaveTextContent('▼');
  expect(headerOf('Login')).not.toHaveAttribute('aria-sort');
  expect(headerOf('Login')).not.toHaveTextContent(/[▲▼]/u);
  rerender(<Signers sort={{ current: { columnId: 'login', direction: 'ascending' }, onChange: vi.fn() }} />);
  expect(headerOf('Login')).toHaveAttribute('aria-sort', 'ascending');
  expect(headerOf('Login')).toHaveTextContent('▲');
  expect(headerOf('Signatures')).not.toHaveAttribute('aria-sort');
  rerender(<Signers sort={{ current: undefined, onChange: vi.fn() }} />);
  expect(table().querySelector('[aria-sort]')).toBeNull();
});

test('a click on a sort button asks for ascending first and for descending on the column that is already ascending', async () => {
  const onChange = vi.fn();
  const { user, rerender } = renderWithProviders(<Signers sort={{ current: undefined, onChange }} />);
  await user.click(screen.getByRole('button', { name: 'Login' }));
  expect(onChange).toHaveBeenLastCalledWith({ columnId: 'login', direction: 'ascending' });
  rerender(<Signers sort={{ current: { columnId: 'login', direction: 'ascending' }, onChange }} />);
  await user.click(screen.getByRole('button', { name: 'Login' }));
  expect(onChange).toHaveBeenLastCalledWith({ columnId: 'login', direction: 'descending' });
  await user.click(screen.getByRole('button', { name: 'Signatures' }));
  expect(onChange).toHaveBeenLastCalledWith({ columnId: 'signatures', direction: 'ascending' });
  expect(onChange).toHaveBeenCalledTimes(3);
});

test('the keyboard sorts: Tab reaches each sort button in order, Enter and Space ask, Escape does nothing', async () => {
  const onChange = vi.fn();
  const { user } = renderWithProviders(<Signers sort={{ current: undefined, onChange }} />);
  await user.tab();
  expect(screen.getByRole('button', { name: 'Login' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(onChange).toHaveBeenLastCalledWith({ columnId: 'login', direction: 'ascending' });
  await user.tab();
  expect(screen.getByRole('button', { name: 'Signatures' })).toHaveFocus();
  await user.keyboard(' ');
  expect(onChange).toHaveBeenLastCalledWith({ columnId: 'signatures', direction: 'ascending' });
  await user.keyboard('{Escape}');
  expect(onChange).toHaveBeenCalledTimes(2);
  await user.tab();
  expect(document.body).toHaveFocus();
});

test.each([
  ['nothing sorted', undefined, 'login', 'ascending'],
  ['the column ascending', { columnId: 'login', direction: 'ascending' }, 'login', 'descending'],
  ['the column descending', { columnId: 'login', direction: 'descending' }, 'login', 'ascending'],
  ['another column ascending', { columnId: 'other', direction: 'ascending' }, 'login', 'ascending'],
] as const)('the next sort with %s is %s', (_what, current, columnId, direction) => {
  expect(nextSort(columnId, current)).toEqual({ columnId, direction });
});

test('with no rows the headings stay and the empty state fills one cell across the table', () => {
  renderWithProviders(
    <DataTable
      caption="Signers"
      columns={COLUMNS}
      rows={[]}
      rowKey={(row: Person) => row.id}
      emptyState={<p>No signers yet.</p>}
    />,
  );
  expect(within(table()).getAllByRole('columnheader')).toHaveLength(4);
  const cells = within(table()).getAllByRole('cell');
  expect(cells).toHaveLength(1);
  expect(cells[0]).toHaveAttribute('colspan', '4');
  expect(cells[0]).toHaveTextContent('No signers yet.');
});

test('rows hide the empty state, and no rows without an empty state is an empty body', () => {
  const { rerender } = renderWithProviders(
    <DataTable
      caption="Signers"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      emptyState={<p>No signers yet.</p>}
    />,
  );
  expect(screen.queryByText('No signers yet.')).not.toBeInTheDocument();
  rerender(<DataTable caption="Signers" columns={COLUMNS} rows={[]} rowKey={(row: Person) => row.id} />);
  expect(within(table()).queryAllByRole('cell')).toHaveLength(0);
  expect(within(table()).getAllByRole('row')).toHaveLength(1);
});

test('a render column that returns a string does not compile: user text goes in a userText column', () => {
  const column: DataColumn<Person> = {
    id: 'login',
    header: 'Login',
    // @ts-expect-error -- the point of the test: a plain string for a user-controlled field is a type error
    render: (row) => row.login,
  };
  expect(column.id).toBe('login');
});

test('the table passes axe, sorted, unsorted and empty', async () => {
  const { container, rerender } = renderWithProviders(
    <Signers sort={{ current: { columnId: 'login', direction: 'ascending' }, onChange: vi.fn() }} />,
  );
  await expectNoA11yViolations(container);
  rerender(<Signers />);
  await expectNoA11yViolations(container);
  rerender(
    <DataTable
      caption="Signers"
      columns={COLUMNS}
      rows={[]}
      rowKey={(row: Person) => row.id}
      emptyState={<p>No signers yet.</p>}
    />,
  );
  await expectNoA11yViolations(container);
});

test('a hostile name in a userText column stays text', () => {
  expectHostileNamesInert((name) =>
    renderWithProviders(
      <DataTable
        caption="Signers"
        columns={COLUMNS}
        rows={[{ id: '1', login: name, signatures: 1, active: true }]}
        rowKey={(row) => row.id}
      />,
    ),
  );
});
