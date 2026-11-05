// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Element, Root, RootContent } from 'hast';
import { createElement, Fragment, type ReactElement, useMemo } from 'react';
import { renderClaTree } from '../../shared/cla-markdown.ts';

// The text of a CLA on screen (E21-S02): the sanitised tree of the one shared pipeline (E12-S07) turned into React elements, with
// no HTML string anywhere and nothing that sets markup. The sanitiser has dropped everything but the elements below; this file
// holds the same line a second time, so a tree that somehow carried a `script`, an `img` or a link to `javascript:` still draws
// as its text. It is the first screen to show a CLA; the reusable markdown view of E18-S01 replaces it when that lands.

/** The elements a rendered CLA holds (the list of the shared pipeline). */
const SAFE_TAGS: ReadonlySet<string> = new Set([
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
]);

/** A link that is followed: only these schemes. */
const SAFE_LINK = /^(?:https?:|mailto:)/iu;

const isLink = (element: Element): boolean => element.tagName === 'a';

/** A link whose address is not one of the schemes above is drawn as its text. */
function isUnsafeLink(element: Element): boolean {
  const href = element.properties.href;
  return isLink(element) && !(typeof href === 'string' && SAFE_LINK.test(href));
}

/** The attributes of an element: the address of a link (always opened as the pipeline says) and the first number of a list. */
function attributesOf(element: Element): Record<string, string | number> {
  const { href, start } = element.properties;
  if (isLink(element) && typeof href === 'string') {
    return { href, rel: 'noopener noreferrer nofollow', target: '_blank' };
  }
  return element.tagName === 'ol' && typeof start === 'number' ? { start } : {};
}

/** What draws as nothing, and the text of a text node: a fragment either way, so every node is one kind of element. */
const plain = (value?: string): ReactElement => createElement(Fragment, null, value);

function toElement(element: Element): ReactElement {
  const children = element.children.map(toNode);
  if (!SAFE_TAGS.has(element.tagName) || isUnsafeLink(element)) {
    return createElement(Fragment, null, ...children);
  }
  return createElement(element.tagName, attributesOf(element), ...children);
}

function toNode(node: RootContent): ReactElement {
  if (node.type === 'element') {
    return toElement(node);
  }
  return node.type === 'text' ? plain(node.value) : plain();
}

/** The look of the text: the elements keep the browser's meaning and take the spacing of the page. */
const LOOK =
  'flex flex-col gap-3 break-words [&_blockquote]:border-l-4 [&_blockquote]:border-line [&_blockquote]:pl-4 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_ul]:list-disc [&_ul]:pl-6';

/**
 * A sanitised tree of the pipeline as elements.
 * @internal Exported for the tests, which draw trees the pipeline never makes (Knip ignores `@internal` exports in production mode).
 */
export function ClaTree({ tree }: { readonly tree: Root }) {
  return <div className={LOOK}>{createElement(Fragment, null, ...tree.children.map(toNode))}</div>;
}

export interface ClaTextProps {
  /** The stored source text of a version, as the API sent it. */
  readonly markdown: string;
}

/** The text of a CLA version: the source goes through `renderClaTree` once per text and is drawn as elements. */
export function ClaText({ markdown }: ClaTextProps) {
  const tree = useMemo(() => renderClaTree(markdown), [markdown]);
  return <ClaTree tree={tree} />;
}
