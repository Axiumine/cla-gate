// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { vi } from 'vitest';
import { renderClaTree } from '../../shared/cla-markdown.ts';

// A stand-in for the render worker of the CLA text (E18) in the web tests: jsdom has no `Worker`. It is a worker that does what the
// real one does (the tree of `renderClaTree`, answered a moment after the message), or does what a bad one does, so the page can be
// tested against each. All values are made up.

/** What the stand-in does with a text: answers with its tree, never answers, fails with an error, or answers with something else. */
export type WorkerBehaviour = 'render' | 'silent' | 'error' | 'garbage';

/** What the stand-ins answer with from now on. */
const doing = { behaviour: 'render' as WorkerBehaviour };

/** Changes what the workers already started, and the ones to come, do with the messages they get from now on. */
export function setWorkerBehaviour(behaviour: WorkerBehaviour): void {
  doing.behaviour = behaviour;
}

/** A render worker that is not one: it records what it was asked and whether it was ended. */
export class FakeRenderWorker extends EventTarget {
  /** Every worker started since `installFakeRenderWorker`, in order. */
  static readonly instances: FakeRenderWorker[] = [];

  terminated = false;
  readonly posted: { readonly source: string }[] = [];
  readonly url: URL | string;
  readonly options: WorkerOptions | undefined;

  constructor(url: URL | string, options?: WorkerOptions) {
    super();
    this.url = url;
    this.options = options;
    FakeRenderWorker.instances.push(this);
  }

  postMessage(message: { readonly source: string }): void {
    this.posted.push(message);
    const behaviour = doing.behaviour;
    setTimeout(() => {
      if (this.terminated || behaviour === 'silent') {
        return;
      }
      if (behaviour === 'error') {
        this.dispatchEvent(new Event('error'));
        return;
      }
      const data = behaviour === 'render' ? { tree: renderClaTree(message.source) } : { tree: 'not a tree' };
      this.dispatchEvent(new MessageEvent('message', { data }));
    }, 0);
  }

  terminate(): void {
    this.terminated = true;
  }
}

/** Puts the stand-in where `Worker` is, forgetting the workers of an earlier test. Undo it with `vi.unstubAllGlobals()`. */
export function installFakeRenderWorker(behaviour: WorkerBehaviour = 'render'): void {
  FakeRenderWorker.instances.length = 0;
  setWorkerBehaviour(behaviour);
  vi.stubGlobal('Worker', FakeRenderWorker);
}
