// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type { Image, ImageReference } from 'mdast';
import rehypeSanitize, { type Options } from 'rehype-sanitize';
import remarkRehype from 'remark-rehype';
import { CLA_MAX_NESTING, nestingOf, opensTooManyContainers } from './cla-markdown-nesting.ts';
import { documentProcessor } from './cla-markdown-parse.ts';

// What signers and maintainers see of a CLA (E12-S07): the stored source text turned into a tree of a few safe elements, in this
// one place. The editor preview, the sign page, the history view and the endpoint of E21 all call it on the same canonical text, so
// they show the same thing; the hash stays over the source, never over what is shown. The steps are: the parse (raw HTML stays
// literal text and is never read as markup), the conversion to a tree of HTML elements, the sanitiser, and the links.

/** The elements a rendered CLA holds. */
const TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'br',
  'hr',
  'a',
];

/** The sanitiser: these elements, `href` on a link, `start` on an ordered list, and links only to http, https and mailto. Nothing else is kept. */
const SANITISE: Options = {
  tagNames: TAGS,
  attributes: { a: ['href'], ol: ['start'] },
  protocols: { href: ['http', 'https', 'mailto'] },
};

/**
 * An address that opens a page or a mail: the text starts with `http://`, `https://` or `mailto:` in lower case, with nothing before
 * it. A scheme in capitals is not one (the sanitiser reads it as another scheme), so that link is its text.
 */
const SAFE_ADDRESS = /^(?:https?:\/\/|mailto:)/;

/** The `rel` of every link: no opener, no referrer, and no weight for search engines. */
const LINK_REL = ['noopener', 'noreferrer', 'nofollow'];

/**
 * What an image becomes: its alternative text, as plain text. The image itself, and so the request it would make, is never in the
 * tree. The alternative text can be missing in the types (`null` or `undefined`), which `join` turns into the empty string.
 */
function altText(_state: unknown, image: Image | ImageReference): ElementContent {
  return { type: 'text', value: [image.alt].join('') };
}

/** What remains of an anchor: itself with the three attributes of a safe link, or, when the address is not one, only its content. */
function settleAnchor(anchor: Element): ElementContent[] {
  const { href } = anchor.properties;
  if (typeof href !== 'string' || !SAFE_ADDRESS.test(href)) {
    return anchor.children;
  }
  anchor.properties = { href, rel: LINK_REL, target: '_blank' };
  return [anchor];
}

/** True for a node an element can hold. A document type declaration cannot be one, and none is in a rendered text. */
function isContent(node: RootContent): node is ElementContent {
  return node.type !== 'doctype';
}

/** `children` with every anchor settled. The tree is as deep as the nesting limit allows, so the recursion is short. */
function settle(children: ElementContent[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child.type !== 'element') {
      return [child];
    }
    child.children = settle(child.children);
    return child.tagName === 'a' ? settleAnchor(child) : [child];
  });
}

/** The step after the sanitiser: a link to anything but http, https or mailto (a relative or protocol-relative one too) is its text. */
function links() {
  return (tree: Root): void => {
    tree.children = settle(tree.children.filter(isContent));
  };
}

const processor = documentProcessor()
  .use(remarkRehype, { handlers: { image: altText, imageReference: altText } })
  .use(rehypeSanitize, SANITISE)
  .use(links);

/** The text of `md` as one block of code: what a text that nests too deeply is shown as. */
function literalBlock(md: string): Root {
  const code: Element = { type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: md }] };
  return { type: 'root', children: [{ type: 'element', tagName: 'pre', properties: {}, children: [code] }] };
}

/**
 * The sanitised tree of the CommonMark text `md`. Only `p`, `h1` to `h6`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`, `em`,
 * `strong`, `br`, `hr` and `a` can be in it, with `href`, `rel` and `target` on a link and `start` on an ordered list. Raw HTML is
 * literal text (a placeholder such as `<company name>` stays visible), an image is its alternative text, and a link is kept only
 * when its address starts with `http://`, `https://` or `mailto:`; otherwise it is its text. A text that nests more than
 * `CLA_MAX_NESTING` levels, which `validateClaText` refuses, is returned as one block of code, so no text can overflow the stack.
 * The web renders the tree into React elements; nothing here is an HTML string.
 *
 * The cost is not linear in the size of the text for every text: the parser takes seconds for some texts of 20 KiB and minutes for
 * some of 200 KiB (hundreds of one-line setext headings, of lazy quote lines or of `[a]` labels in one paragraph). A server must
 * therefore not call this on the thread that serves requests for a text it has not rendered before: it renders in a worker with a
 * time limit, once per content hash, and keeps the result (E21). `validateClaText` does not call it for that reason.
 */
export function renderClaTree(md: string): Root {
  if (opensTooManyContainers(md)) {
    return literalBlock(md);
  }
  const parsed = processor.parse(md);
  const { blocks, inlines } = nestingOf(parsed);
  if (blocks > CLA_MAX_NESTING || inlines > CLA_MAX_NESTING) {
    return literalBlock(md);
  }
  return processor.runSync(parsed);
}

/** The HTML of `renderClaTree(md)`, for the consumers that are not React (the endpoint of E21). Text and attribute values are escaped. */
export function renderClaHtml(md: string): string {
  return toHtml(renderClaTree(md));
}
