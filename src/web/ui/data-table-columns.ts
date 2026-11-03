// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ReactElement } from 'react';

// The column definitions of DataTable (E17-S10). The two kinds are what makes a plain string for a user-controlled field a
// type error: a person's text can only go in a `userText` column, which the table draws through `UserText`, and a `render`
// column returns an element (or a number), never a string.

interface ColumnBase {
  /** Names the column in `sort` and keys its cells: unique within the table. */
  readonly id: string;
  /** The column heading: text from the catalog. */
  readonly header: string;
  /** The heading is a button that asks for this column to be the sort order. Needs `sort` on the table. */
  readonly sortable?: boolean;
}

/** A column of text a person controls (a login, a name, a repository, a rationale): the table shows it through `UserText`. */
export interface UserTextColumn<Row> extends ColumnBase {
  readonly userText: (row: Row) => string;
}

/**
 * A column of anything else: a badge, a time, a link, a number, a message from the catalog in a fragment. A string does not
 * compile here, on purpose: `render: (row) => row.login` would put user text on the screen without `UserText`.
 */
export interface RenderColumn<Row> extends ColumnBase {
  readonly render: (row: Row) => ReactElement | number | null;
}

export type DataColumn<Row> = UserTextColumn<Row> | RenderColumn<Row>;

export type SortDirection = 'ascending' | 'descending';

/** What the rows are ordered by. The server orders them (the lists are cursor-paged), so the table only shows and asks. */
export interface TableSort {
  readonly columnId: string;
  readonly direction: SortDirection;
}

/** The sort of a table: what it is now (absent when the server's default order is in use) and what to do when a heading is chosen. */
export interface SortControl {
  readonly current: TableSort | undefined;
  readonly onChange: (sort: TableSort) => void;
}

/** The sort a click on the heading of `columnId` asks for: ascending first, and the other way round on a column that is already ascending. */
export function nextSort(columnId: string, current: TableSort | undefined): TableSort {
  const flip = current?.columnId === columnId && current.direction === 'ascending';
  return { columnId, direction: flip ? 'descending' : 'ascending' };
}
