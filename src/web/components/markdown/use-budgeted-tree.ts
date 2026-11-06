// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Root } from 'hast';
import { useEffect, useState } from 'react';
import { RENDER_BUDGET_MS } from './render-limits.ts';
import { treeOf } from './render-protocol.ts';
import { startRenderWorker } from './start-render-worker.ts';

/** Where the render of a text stands: under way, done, or given up (the text is then shown as it was written). */
export type TreeState =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly tree: Root }
  | { readonly status: 'unavailable' };

/** What an effect knows about the text it was started for, so the answer for an older text is never taken for the current one. */
interface Settled {
  readonly source: string;
  readonly state: Exclude<TreeState, { readonly status: 'pending' }>;
}

/**
 * The tree of a CLA text, rendered by a worker of its own and ended when it takes longer than the budget (E18). The text is rendered
 * away from the page, so a text that the parser handles slowly cannot freeze the tab; when the worker is not there, fails, answers
 * with something that is not a tree, or is still busy after `budgetMs`, the state is `unavailable` and the caller shows the text as
 * it was written. A new text starts a new worker and ends the old one; so does leaving the page.
 */
export function useBudgetedTree(source: string, budgetMs: number = RENDER_BUDGET_MS): TreeState {
  const [settled, setSettled] = useState<Settled | undefined>(undefined);
  useEffect(() => {
    const worker = startRenderWorker();
    let finished = false;
    const finish = (state: Settled['state']) => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timer);
      worker?.terminate();
      setSettled({ source, state });
    };
    const timer = setTimeout(
      () => {
        finish({ status: 'unavailable' });
      },
      worker === undefined ? 0 : budgetMs,
    );
    worker?.addEventListener('message', (event: MessageEvent<unknown>) => {
      const tree = treeOf(event.data);
      finish(tree === undefined ? { status: 'unavailable' } : { status: 'ready', tree });
    });
    worker?.addEventListener('error', () => {
      finish({ status: 'unavailable' });
    });
    worker?.postMessage({ source });
    return () => {
      finished = true;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [source, budgetMs]);
  return settled?.source === source ? settled.state : { status: 'pending' };
}
