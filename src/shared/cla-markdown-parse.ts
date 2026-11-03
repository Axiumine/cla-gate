// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import remarkParse from 'remark-parse';
import { unified } from 'unified';

// The one Markdown parser of the CLA text (E12-S07): remark-parse, which is CommonMark with no extension (no tables, no task
// lists, no strikethrough, no footnotes), set up in two ways. The document parser reads everything but raw HTML and is the first
// step of the rendering. The block parser reads only the block structure and is what the depth rule of `validateClaText` measures:
// in CommonMark the blocks are decided before the inline text is read, so the two agree on every quote and list, while the block
// parser never pays for the inline phase, whose cost grows faster than the size of the text for some inputs (runs of labels,
// nested emphasis) and which a request must not wait for.

/** Raw HTML is never parsed: `<company name>` is text, and so is `<script>`, a comment or a tag with an `onerror`. */
const RAW_HTML = ['htmlFlow', 'htmlText'];

/** The constructs of the inline phase that can be switched off without changing a block (links, images, emphasis, code spans...). */
const INLINE_CONSTRUCTS = [
  'attention',
  'autolink',
  'characterEscape',
  'characterReference',
  'codeText',
  'hardBreakEscape',
  'labelEnd',
  'labelStartImage',
  'labelStartLink',
];

/** A new processor that parses the whole CommonMark text but raw HTML, which stays literal text; the caller adds the steps that follow. */
export function documentProcessor() {
  return unified()
    .use(remarkParse)
    .data('micromarkExtensions', [{ disable: { null: RAW_HTML } }]);
}

/** The processor that parses the block structure alone; its tree holds the quotes, lists, paragraphs and headings, but no inline node. */
export const blockProcessor = unified()
  .use(remarkParse)
  .data('micromarkExtensions', [{ disable: { null: [...RAW_HTML, ...INLINE_CONSTRUCTS] } }]);
