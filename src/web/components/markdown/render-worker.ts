// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { renderClaTree } from '../../../shared/cla-markdown.ts';
import { RENDER_FAILED, type RenderAnswer, renderRequestSchema } from './render-protocol.ts';

// The worker that renders a long CLA text (E18). The parser of the text does not take linear time for every text (see
// `renderClaTree`), so a long text is rendered here, away from the page, and the page ends the worker when the answer takes too long:
// a text that is slow to render cannot freeze the tab of the person who opens it.

/** The answer to one message: the tree of the text it holds, or the failure when the message is not a text or the render throws. */
export function answerRender(message: unknown): RenderAnswer {
  const request = renderRequestSchema.safeParse(message);
  if (!request.success) {
    return RENDER_FAILED;
  }
  try {
    return { tree: renderClaTree(request.data.source) };
  } catch {
    return RENDER_FAILED;
  }
}

// eslint-disable-next-line sonarjs/post-message -- a dedicated worker is reachable only by the page that started it, so there is no other origin to check
self.addEventListener('message', (event: MessageEvent<unknown>) => {
  self.postMessage(answerRender(event.data));
});
