// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  type DataColumn,
  nextSort,
  type SortControl,
  type SortDirection,
  type TableSort,
} from './data-table-columns.ts';

/** The arrow on the heading the rows are sorted by; the direction is also in `aria-sort`, so the arrow is only for the eye. */
const arrowOf = (direction: SortDirection | undefined): string => {
  if (direction === undefined) {
    return '';
  }
  return direction === 'ascending' ? '▲' : '▼';
};

/** The heading of a column that is a sort button: its name, and an arrow on the one that sorts the rows now. */
function SortButton({
  column,
  current,
  onChange,
}: {
  readonly column: { readonly id: string; readonly header: string };
  readonly current: TableSort | undefined;
  readonly onChange: (sort: TableSort) => void;
}) {
  const direction = current?.columnId === column.id ? current.direction : undefined;
  return (
    <button
      type="button"
      onClick={() => {
        onChange(nextSort(column.id, current));
      }}
      className="inline-flex cursor-pointer items-center gap-1 font-semibold"
    >
      {column.header}
      <span aria-hidden="true" className="text-xs">
        {arrowOf(direction)}
      </span>
    </button>
  );
}

/** The heading cell of a column (E17-S10): plain text, or a sort button with `aria-sort` when the column sorts and the table has a `sort`. */
export function ColumnHeading<Row>({
  column,
  sort,
}: {
  readonly column: DataColumn<Row>;
  readonly sort: SortControl | undefined;
}) {
  if (column.sortable !== true || sort === undefined) {
    return (
      <th scope="col" className="px-3 py-2 text-left font-semibold">
        {column.header}
      </th>
    );
  }
  const sorted = sort.current?.columnId === column.id ? sort.current.direction : undefined;
  return (
    <th scope="col" aria-sort={sorted} className="px-3 py-2 text-left font-semibold">
      <SortButton column={column} current={sort.current} onChange={sort.onChange} />
    </th>
  );
}
