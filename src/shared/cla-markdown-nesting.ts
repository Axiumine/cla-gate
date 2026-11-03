// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Nodes } from 'mdast';
import { containerDepth } from './cla-markdown-containers.ts';

// How deep a CLA text may nest (E12-S07). A block quote or a list inside another costs the parser, and every step after it, a
// level of recursion, so the depth is bounded: `validateClaText` refuses a text above `CLA_MAX_NESTING` levels (read line by line
// by `cla-markdown-containers.ts`), and the rendering shows a text that is deeper than that, in the tree it parsed, as plain text
// instead of overflowing the stack.

/** The most block quotes and lists one inside the other (and, in the rendering, the most emphasis, strong text and links). */
export const CLA_MAX_NESTING = 50;

/** The most container markers one line may open before the parse: twice the depth, so that a rule such as `* * * *` is no problem. */
const LINE_MARKER_LIMIT = 2 * CLA_MAX_NESTING;

/** Lines end in LF, CRLF or a lone CR. */
const LINE_ENDING = /\r\n?|\n/;

/**
 * One container marker with the white space before it, at the start of what is left of a line: `>`, a bullet (`-`, `+` or `*`) or
 * an ordered number of up to nine digits with `.` or `)`, the last two only when a space, a tab or the end of the line follows.
 */
const CONTAINER_MARKER = /^[ \t]*(?:>|[-+*](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))/;

const BLOCK_TYPES: ReadonlySet<string> = new Set(['blockquote', 'list']);
const INLINE_TYPES: ReadonlySet<string> = new Set(['emphasis', 'strong', 'link', 'linkReference']);

/** True when `line` opens more container markers in a row than `LINE_MARKER_LIMIT`; it stops reading at the first one over. */
function opensTooMany(line: string): boolean {
  let rest = line;
  for (let markers = 0; markers <= LINE_MARKER_LIMIT; markers += 1) {
    const marker = CONTAINER_MARKER.exec(rest);
    if (marker === null) {
      return false;
    }
    rest = rest.slice(marker[0].length);
  }
  return true;
}

/**
 * True when a line of `md` begins with more than 100 container markers (`> > > ...`, `- - - ...`, `1. 1. 1. ...`). This is read
 * from the text in one pass, before any parse: the parser takes longer than the size of the text for such a line (a quarter of
 * a minute for a run of 100 000 `>`), and a line with that many markers is nested far above the limit in any case. A marker in
 * code or in a paragraph counts too, which is a safe error: nobody writes a hundred of them in a row there.
 */
export function opensTooManyContainers(md: string): boolean {
  return md.split(LINE_ENDING).some(opensTooMany);
}

/** The most block containers (quotes and lists) and the most inline ones (emphasis, strong text and links) one inside the other. */
export interface Nesting {
  readonly blocks: number;
  readonly inlines: number;
}

/** A node with the number of block and inline containers above it and including it. */
interface Level {
  readonly node: Nodes;
  readonly blocks: number;
  readonly inlines: number;
}

/** The deepest nesting of the tree under `root`. The walk keeps its own list of nodes to visit, so a deep tree cannot overflow the stack. */
export function nestingOf(root: Nodes): Nesting {
  let blocks = 0;
  let inlines = 0;
  const pending: Level[] = [{ node: root, blocks: 0, inlines: 0 }];
  for (let level = pending.pop(); level !== undefined; level = pending.pop()) {
    const { node } = level;
    const nodeBlocks = level.blocks + (BLOCK_TYPES.has(node.type) ? 1 : 0);
    const nodeInlines = level.inlines + (INLINE_TYPES.has(node.type) ? 1 : 0);
    blocks = Math.max(blocks, nodeBlocks);
    inlines = Math.max(inlines, nodeInlines);
    if ('children' in node) {
      for (const child of node.children) {
        pending.push({ node: child, blocks: nodeBlocks, inlines: nodeInlines });
      }
    }
  }
  return { blocks, inlines };
}

/**
 * True when the block quotes and lists of `md` nest above `CLA_MAX_NESTING` levels. Read by `containerDepth`, line by line, in time
 * linear in the size of the text: this runs on the request that saves or publishes a text, and a Markdown parser takes minutes for
 * some texts of 200 KiB, so none is called here. The rendering checks the tree it parses as well, so a text where the scan and the
 * parser differ by a level (it happens in odd corners) still cannot overflow the stack.
 */
export function isNestedTooDeeply(md: string): boolean {
  return containerDepth(md, CLA_MAX_NESTING) > CLA_MAX_NESTING;
}
