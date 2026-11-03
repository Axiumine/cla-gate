// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import remarkParse from 'remark-parse';
import { unified } from 'unified';

// The one Markdown parser of the CLA text (E12-S07): remark-parse, which is CommonMark with no extension (no tables, no task
// lists, no strikethrough, no footnotes). It reads everything but raw HTML and is the first step of the rendering. Its cost is not
// linear for every text (some texts of 200 KiB take minutes), so nothing on a request that saves or publishes a text calls it: the
// depth rule of `validateClaText` reads the lines itself (`cla-markdown-containers.ts`).

/** Raw HTML is never parsed: `<company name>` is text, and so is `<script>`, a comment or a tag with an `onerror`. */
const RAW_HTML = ['htmlFlow', 'htmlText'];

/** A new processor that parses the whole CommonMark text but raw HTML, which stays literal text; the caller adds the steps that follow. */
export function documentProcessor() {
  return unified()
    .use(remarkParse)
    .data('micromarkExtensions', [{ disable: { null: RAW_HTML } }]);
}
