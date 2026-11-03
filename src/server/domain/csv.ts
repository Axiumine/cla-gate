// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// CSV for the signature export (E16-S03): RFC 4180 with a guard against spreadsheet formulas. Pure: it turns cells into text
// and does nothing else, so every cell of every export goes through the same two rules.

/** The line end of RFC 4180. A row ends with it, the last row too. */
const LINE_END = '\r\n';

/**
 * The characters that make a spreadsheet read a cell as a formula, a command or a data link when they start it: the equals
 * sign, the plus and the minus sign, the at sign, a tab and a carriage return.
 */
const FORMULA_TRIGGERS: ReadonlySet<string> = new Set(['=', '+', '-', '@', '\t', '\r']);

/** A field with one of these must be quoted. */
const NEEDS_QUOTES = /["\r\n,]/;

/**
 * The cell as a spreadsheet must read it: a cell that begins with a trigger character gets a single quote in front, which
 * spreadsheet software shows as nothing and takes to mean "text". It holds for every cell, whoever wrote it.
 * @internal Exported for the tests of the six trigger characters (Knip ignores `@internal` exports in production mode).
 */
export function neutraliseFormula(cell: string): string {
  return FORMULA_TRIGGERS.has(cell.charAt(0)) ? `'${cell}` : cell;
}

/**
 * One cell as RFC 4180 writes it, after {@link neutraliseFormula}: quoted when it holds a double quote, a comma, a
 * carriage return or a line feed, with every double quote doubled; written as it is otherwise.
 * @internal Exported for the tests of the quoting (Knip ignores `@internal` exports in production mode).
 */
export function encodeCsvCell(cell: string): string {
  const safe = neutraliseFormula(cell);
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** One row: its cells joined by commas and the CRLF that ends it. The text is not yet bytes; write it as UTF-8 with no byte order mark. */
export function encodeCsvRow(cells: readonly string[]): string {
  return `${cells.map(encodeCsvCell).join(',')}${LINE_END}`;
}
