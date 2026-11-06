// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Root } from 'hast';
import { z } from 'zod';

// What the page and the render worker say to each other (E18): the page sends the source of a CLA text, and the worker answers with
// the sanitised tree of `renderClaTree`, or says that it could not make one. Both sides read what they receive before they use it.

/** The text of a CLA, as the page hands it to the worker. */
export const renderRequestSchema = z.object({ source: z.string() });

/** The worker could not make a tree (the render threw); the page then shows the text as it was written. */
export const RENDER_FAILED = { failed: true } as const;

/** The answer of the worker: the tree, or the failure. */
export type RenderAnswer = { readonly tree: Root } | typeof RENDER_FAILED;

/** True when `value` has the shape of the root of a tree, which is all the page needs to know: `drawTree` draws only what it knows. */
function isRoot(value: unknown): value is Root {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'root' &&
    'children' in value &&
    Array.isArray(value.children)
  );
}

/** The tree in an answer of the worker, or `undefined` for a failure or for anything that is not an answer. */
export function treeOf(answer: unknown): Root | undefined {
  if (typeof answer !== 'object' || answer === null || !('tree' in answer)) {
    return undefined;
  }
  return isRoot(answer.tree) ? answer.tree : undefined;
}
