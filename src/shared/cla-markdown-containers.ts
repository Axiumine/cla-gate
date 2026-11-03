// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { afterQuoteMarker, type Container, openContainers } from './cla-markdown-items.ts';
import { classify, closesFence, type Fence, type Leaf } from './cla-markdown-leaf.ts';
import { CODE_INDENT, type Cursor, skipColumns, skipWhite } from './cla-markdown-lines.ts';

// How deep the block quotes and lists of a Markdown text nest (E12-S07), read line by line in time linear in the size of the text.
// The rule of `validateClaText` runs on the request thread, so it cannot wait for a Markdown parser: the parser of the rendering
// takes minutes for some texts of 200 KiB (a run of one-line setext headings, a run of lazy quote lines) because its cost grows
// with the square of the number of lines. This scan follows the rules CommonMark gives for the containers (the white space and the
// `>` that continue one, the markers that open one, the lazy continuation of a paragraph, fenced code, which opens none) and keeps
// the stack of the open ones. A test lets it and the parser agree on a corpus and on thousands of generated texts.

/** Lines end in LF, CRLF or a lone CR. */
const LINE_ENDING = /\r\n?|\n/;

const LINE_START: Cursor = { pos: 0, col: 0 };

/** The scan: the stack of open containers, whether the last block is a paragraph, and the fenced code that is open. */
class ContainerScan {
  private readonly stack: Container[] = [];
  private readonly limit: number;
  private paragraph = false;
  private code = false;
  private fence: Fence | null = null;
  private deepest = 0;

  public constructor(limit: number) {
    this.limit = limit;
  }

  /** The most containers open at once so far; once it is above `limit` the scan reads no further and the number is not exact. */
  public get depth(): number {
    return this.deepest;
  }

  /** Reads one line. */
  public feed(line: string): void {
    const [matched, cursor] = this.matchOpen(line, LINE_START);
    const whole = matched === this.stack.length;
    if (this.insideFence(line, cursor, whole)) {
      return;
    }
    // Micromark lets an item start in the middle of a paragraph, or right after indented code, only when it is numbered 1 and has
    // something after its marker; it does not when a container of the line is not continued (that line may be a lazy one).
    const interrupts = whole && (this.paragraph || this.code);
    const { containers, cursor: rest } = openContainers(line, cursor, this.limit - matched, interrupts);
    const following = containers.length === 0 && this.paragraph;
    const leaf = classify(line, rest, following, following && whole);
    // A line of text that no container takes and that no new block starts goes on with the paragraph it follows (lazy continuation).
    if (!(following && !whole && leaf.kind === 'text')) {
      this.settle(matched, containers, leaf, whole);
    }
  }

  /** True when the line is inside fenced code that its containers hold: it opens nothing, and it may close the fence. */
  private insideFence(line: string, cursor: Cursor, whole: boolean): boolean {
    if (this.fence === null || !whole) {
      return false;
    }
    this.fence = closesFence(line, cursor, this.fence) ? null : this.fence;
    return true;
  }

  /** Closes the containers the line does not continue, opens the new ones and notes what the line itself is. */
  private settle(matched: number, containers: Container[], leaf: Leaf, whole: boolean): void {
    this.stack.length = matched;
    this.stack.push(...containers);
    this.deepest = Math.max(this.deepest, this.stack.length);
    this.fence = leaf.kind === 'fence' ? { char: leaf.char, length: leaf.length } : null;
    this.paragraph = leaf.kind === 'text';
    // An indented code block goes on over blank lines and ends with the container that held it.
    const goesOn = leaf.kind === 'blank' && containers.length === 0 && this.code;
    this.code = whole && (leaf.kind === 'code' || goesOn);
  }

  /** Walks down the open containers while the line continues them. */
  private matchOpen(line: string, from: Cursor): [number, Cursor] {
    let cursor = from;
    let matched = 0;
    for (const container of this.stack) {
      const next = this.continues(container, line, cursor);
      if (next === null) {
        break;
      }
      cursor = next;
      matched += 1;
    }
    return [matched, cursor];
  }

  /** The cursor after what `container` takes of the line, or `null` when the line does not continue it. */
  private continues(container: Container, line: string, cursor: Cursor): Cursor | null {
    const start = skipWhite(line, cursor);
    if (container.kind === 'quote') {
      return line.charAt(start.pos) === '>' && start.col - cursor.col < CODE_INDENT
        ? afterQuoteMarker(line, start)
        : null;
    }
    if (start.pos >= line.length) {
      return container.empty ? null : cursor;
    }
    if (start.col - cursor.col < container.indent) {
      return null;
    }
    container.empty = false;
    return skipColumns(line, cursor, container.indent);
  }
}

/** The most block quotes and lists one inside the other in `md`; above `limit` the number is only known to be above it. */
export function containerDepth(md: string, limit: number): number {
  const scan = new ContainerScan(limit);
  for (const line of md.split(LINE_ENDING)) {
    scan.feed(line);
    if (scan.depth > limit) {
      break;
    }
  }
  return scan.depth;
}
