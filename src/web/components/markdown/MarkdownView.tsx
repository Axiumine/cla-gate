// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMemo } from 'react';
import { renderClaTree } from '../../../shared/cla-markdown.ts';
import { useT } from '../../i18n/index.ts';
import type { HeadingLevel } from '../../ui/Heading.tsx';
import { StatusMessage } from '../../ui/StatusMessage.tsx';
import { drawTree } from './hast-react.tsx';
import { SYNC_RENDER_MAX_CHARS } from './render-limits.ts';
import { useBudgetedTree } from './use-budgeted-tree.ts';

export interface MarkdownViewProps {
  /** The stored source text of the CLA (the text that was hashed), never HTML. */
  readonly source: string;
  /**
   * The level that the `h1` of the text is shown as. The page that shows a CLA has its own `h1`, so the text starts one level
   * below it: `2` unless the page says otherwise. Every other heading of the text moves down by the same amount, up to `h6`.
   */
  readonly headingLevel?: HeadingLevel;
}

/** A text rendered by the page itself: short enough that even the worst such text costs a fraction of a second. */
function ShortText({ source, headingLevel }: Required<MarkdownViewProps>) {
  const tree = useMemo(() => renderClaTree(source), [source]);
  return <div className="text-fg">{drawTree(tree, headingLevel)}</div>;
}

/**
 * A long text, rendered by a worker with a time budget. While the worker is busy the page says so; when the worker cannot finish
 * in time, or is not there, the text is shown exactly as it was written, in a block of code, with a note: the person can still read
 * and sign what the hash covers, and the tab never waits for the parser.
 */
function LongText({ source, headingLevel }: Required<MarkdownViewProps>) {
  const t = useT();
  const state = useBudgetedTree(source);
  if (state.status === 'ready') {
    return <div className="text-fg">{drawTree(state.tree, headingLevel)}</div>;
  }
  if (state.status === 'pending') {
    return <StatusMessage>{t('markdown.pending')}</StatusMessage>;
  }
  return (
    <div className="text-fg">
      <StatusMessage tone="info">{t('markdown.plain')}</StatusMessage>
      <pre className="my-3 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface-muted p-3 text-sm">{source}</pre>
    </div>
  );
}

/**
 * A CLA text as it is read (E18-S01): the sanitised tree of `renderClaTree` (E12-S07) drawn as React elements. The sanitising
 * rules are the ones of that function and are not repeated here: raw HTML is text, a link is kept only when it goes to
 * `http:`, `https:` or `mailto:` and then opens in a new tab with `rel="noopener noreferrer nofollow"`, and an image is its
 * alternative text. No markdown library is added, and no markup is set (the elements are made by React), so nothing in the text
 * can run. The editor preview and the history view (E18-S05, E18-S11) draw their texts with this component too.
 *
 * Rendering costs more than linear time for some texts, and the text of a CLA is chosen by a tenant admin, so it must not be able
 * to freeze the tab of a contributor. A text of up to `SYNC_RENDER_MAX_CHARS` characters is rendered here, in a fraction of a second
 * even in the worst case, and the tree is kept until the text changes. A longer one is rendered by a worker that the page ends after
 * `RENDER_BUDGET_MS`, and a text that does not finish in time is shown as it was written.
 */
export function MarkdownView({ source, headingLevel = 2 }: MarkdownViewProps) {
  return source.length <= SYNC_RENDER_MAX_CHARS ? (
    <ShortText source={source} headingLevel={headingLevel} />
  ) : (
    <LongText source={source} headingLevel={headingLevel} />
  );
}
