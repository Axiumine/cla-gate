// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// A strict reader of RFC 4180, for the tests of the export (E16-S03): it reads back what the encoder wrote, so a test
// asserts on cells and not on the bytes the encoder happens to produce. It accepts nothing the RFC does not: every row, the
// last too, ends with CRLF, and a quote opens a field only at its start.
import { z } from 'zod';

/** One field and what ends it: a quoted one (with `""` for a quote) or a plain one that holds no quote, comma or line break. */
const FIELD = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n)/y;

/**
 * The rows of `text`, as lists of cells.
 * @throws Error naming the position when `text` is not RFC 4180 with a CRLF after every row.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let position = 0;
  while (position < text.length) {
    FIELD.lastIndex = position;
    const match = FIELD.exec(text);
    if (match === null) {
      throw new Error(`not RFC 4180 at character ${position}`);
    }
    const [, quoted, plain, end] = match;
    row.push(quoted === undefined ? z.string().parse(plain) : quoted.replaceAll('""', '"'));
    position = FIELD.lastIndex;
    if (end === '\r\n') {
      rows.push(row);
      row = [];
    }
  }
  return rows;
}

/**
 * The data rows of `text` as records by the name in the header row.
 * @throws Error when `text` is not RFC 4180, has no header row, or has a row with fewer cells than the header.
 */
export function csvRecords(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  const names = z.array(z.string()).parse(header);
  return rows.map((cells) => Object.fromEntries(names.map((name, index) => [name, z.string().parse(cells.at(index))])));
}
