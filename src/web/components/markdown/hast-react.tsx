// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Element, Root, RootContent } from 'hast';
import { createElement, Fragment, type ReactElement } from 'react';
import { Heading, type HeadingLevel } from '../../ui/Heading.tsx';
import { shownHeadingLevel } from './heading-level.ts';

// The tree of a CLA text as React elements (E18-S01). The tree comes from `renderClaTree`, which has already applied the
// sanitiser (E12-S07): nothing here parses Markdown or HTML, and nothing here sets markup, so there is no
// `dangerouslySetInnerHTML`. This module only chooses what each node of that tree becomes: a text node is a React text node,
// which React escapes, and an element is one of the few below. An element the tree should never hold is dropped and its
// content is kept as text, so a tree that is not the sanitiser's still cannot put a script, an image or a form on the page.

/** The look of each element a rendered CLA holds (Tailwind classes); a tag that is not here is not drawn. */
const CLASSES: ReadonlyMap<string, string> = new Map([
  ['p', 'my-3 leading-relaxed'],
  ['ul', 'my-3 list-disc ps-6'],
  ['ol', 'my-3 list-decimal ps-6'],
  ['li', 'my-1'],
  ['blockquote', 'my-3 border-s-4 border-line ps-4 text-fg-muted'],
  ['pre', 'my-3 overflow-x-auto rounded-md bg-surface-muted p-3 text-sm'],
  ['code', 'font-mono text-sm'],
  ['em', 'italic'],
  ['strong', 'font-semibold'],
  ['hr', 'my-4 border-line'],
  ['a', 'underline underline-offset-2 wrap-anywhere'],
]);

/** What every link opens with: a new tab without an opener or a referrer, and no weight for search engines (E12-S07). */
const LINK_REL = 'noopener noreferrer nofollow';

/** The context of the walk: how far the tree's headings move down, and the key prefix of the node being drawn. */
interface Walk {
  readonly top: HeadingLevel;
  readonly path: string;
}

/** The `start` of an ordered list, when the tree gives a whole number. */
function startOf(element: Element): number | undefined {
  const { start } = element.properties;
  return typeof start === 'number' ? start : undefined;
}

/** The address of a link, when the tree gives one as text. */
function hrefOf(element: Element): string | undefined {
  const { href } = element.properties;
  return typeof href === 'string' ? href : undefined;
}

/** The nodes of `nodes` as React nodes, each keyed by its place in the tree. */
function drawAll(nodes: readonly RootContent[], walk: Walk): ReactElement[] {
  return nodes.map((node, index) => draw(node, { ...walk, path: `${walk.path}.${index}` }));
}

/** The elements that hold content and take nothing from the tree but their children. */
const CONTAINER_TAGS = ['p', 'ul', 'li', 'blockquote', 'pre', 'code', 'em', 'strong'] as const;
type ContainerTag = (typeof CONTAINER_TAGS)[number];
const CONTAINERS: ReadonlySet<string> = new Set(CONTAINER_TAGS);

function isContainer(tagName: string): tagName is ContainerTag {
  return CONTAINERS.has(tagName);
}

/**
 * An element that holds content: the tag the tree names, with the look of {@link CLASSES} and no attribute of the tree, except
 * the `start` of an ordered list. A tag that is not one of these is not drawn, and its content stays as it is.
 */
function drawContainer(element: Element, walk: Walk): ReactElement {
  const className = CLASSES.get(element.tagName);
  const children = drawAll(element.children, walk);
  if (isContainer(element.tagName)) {
    return createElement(element.tagName, { key: walk.path, className }, children);
  }
  return element.tagName === 'ol' ? (
    <ol key={walk.path} start={startOf(element)} className={className}>
      {children}
    </ol>
  ) : (
    <Fragment key={walk.path}>{children}</Fragment>
  );
}

/** A link with an address; without one, only its content. */
function drawAnchor(element: Element, walk: Walk): ReactElement {
  const href = hrefOf(element);
  const children = drawAll(element.children, walk);
  return href === undefined ? (
    <Fragment key={walk.path}>{children}</Fragment>
  ) : (
    <a key={walk.path} href={href} rel={LINK_REL} target="_blank" className={CLASSES.get('a')}>
      {children}
    </a>
  );
}

/** An element of the tree. */
function drawElement(element: Element, walk: Walk): ReactElement {
  const level = shownHeadingLevel(element.tagName, walk.top);
  if (level !== undefined) {
    return (
      <Heading key={walk.path} level={level}>
        {drawAll(element.children, walk)}
      </Heading>
    );
  }
  switch (element.tagName) {
    case 'br':
      return <br key={walk.path} />;
    case 'hr':
      return <hr key={walk.path} className={CLASSES.get('hr')} />;
    case 'a':
      return drawAnchor(element, walk);
    default:
      return drawContainer(element, walk);
  }
}

/** One node: text is text, an element is drawn, and a comment, a doctype or a raw node (which the sanitiser removed) is nothing. */
function draw(node: RootContent, walk: Walk): ReactElement {
  if (node.type === 'text') {
    return <Fragment key={walk.path}>{node.value}</Fragment>;
  }
  return node.type === 'element' ? drawElement(node, walk) : <Fragment key={walk.path} />;
}

/**
 * The React nodes for `tree`. `top` is the level that the tree's own `h1` is shown as (the page's `h1` is above it), and
 * every other heading moves down by the same amount, up to `h6`.
 */
export function drawTree(tree: Root, top: HeadingLevel): ReactElement[] {
  return drawAll(tree.children, { top, path: 'n' });
}
