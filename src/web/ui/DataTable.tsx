// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactNode } from 'react';
import { ColumnHeading } from './DataTableHeading.tsx';
import type { DataColumn, SortControl } from './data-table-columns.ts';
import { UserText } from './UserText.tsx';

export interface DataTableProps<Row> {
  /** What the table is about: its accessible name, read out when a screen reader enters it. Text from the catalog. */
  readonly caption: string;
  /** Show the caption above the table. Absent, it is there for assistive technology only. */
  readonly captionVisible?: boolean;
  readonly columns: readonly DataColumn<Row>[];
  readonly rows: readonly Row[];
  /** A key that is the same for the same row on every page and never taken from user text: an id. */
  readonly rowKey: (row: Row) => string;
  readonly sort?: SortControl;
  /** Drawn in a row of its own when there are no rows (an `EmptyState`); the headings stay. */
  readonly emptyState?: ReactNode;
}

function Cell<Row>({ column, row }: { readonly column: DataColumn<Row>; readonly row: Row }) {
  return (
    <td className="px-3 py-2 align-top">
      {'render' in column ? column.render(row) : <UserText>{column.userText(row)}</UserText>}
    </td>
  );
}

/**
 * A semantic table (E17-S10): a caption, `scope="col"` headings, and `aria-sort` on the heading the rows are sorted by.
 * A sortable heading is a button, so the keyboard sorts it with Enter or Space. Text a person controls is drawn by the
 * table itself through `UserText` (a `userText` column), and the columns of anything else cannot return a string.
 */
export function DataTable<Row>({
  caption,
  captionVisible = false,
  columns,
  rows,
  rowKey,
  sort,
  emptyState,
}: DataTableProps<Row>) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className={captionVisible ? 'pb-2 text-left text-base font-semibold' : 'sr-only'}>{caption}</caption>
      <thead className="border-b border-line">
        <tr>
          {columns.map((column) => (
            <ColumnHeading key={column.id} column={column} sort={sort} />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && emptyState !== undefined ? (
          <tr>
            <td colSpan={columns.length} className="px-3 py-6">
              {emptyState}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={rowKey(row)} className="border-b border-line last:border-b-0">
              {columns.map((column) => (
                <Cell key={column.id} column={column} row={row} />
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
