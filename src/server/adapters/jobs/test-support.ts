// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Mock, vi } from 'vitest';
import type { Boss } from './boss.ts';
import { QUEUE_DEFINITIONS } from './queues.ts';

// A pg-boss that is only a script (E07-S01): every method is a mock with a harmless answer, so a test overrides the ones it
// is about and reads what the code under test asked. pg-boss itself needs a real PostgreSQL (see enqueuer-contract.test.ts).

export type FakeBoss = { readonly [Method in keyof Boss]: Mock<Boss[Method]> } & {
  /** Calls every listener registered for the `error` event, as pg-boss does when it reports an error. */
  readonly emitError: (error: Error) => void;
};

/** A pg-boss in which every queue exists with its policy, nothing is queued and every call succeeds. */
export function fakeBoss(): FakeBoss {
  const listeners: ((error: Error) => void)[] = [];
  return {
    start: vi.fn<Boss['start']>(() => Promise.resolve()),
    stop: vi.fn<Boss['stop']>(() => Promise.resolve()),
    on: vi.fn<Boss['on']>((_event, listener) => {
      listeners.push(listener);
    }),
    createQueue: vi.fn<Boss['createQueue']>(() => Promise.resolve()),
    getQueues: vi.fn<Boss['getQueues']>((names) =>
      Promise.resolve(QUEUE_DEFINITIONS.filter(({ name }) => names.includes(name))),
    ),
    getBamStatus: vi.fn<Boss['getBamStatus']>(() => Promise.resolve([])),
    send: vi.fn<Boss['send']>(() => Promise.resolve('job-id')),
    findJobs: vi.fn<Boss['findJobs']>(() => Promise.resolve([])),
    deleteJob: vi.fn<Boss['deleteJob']>(() => Promise.resolve(undefined)),
    emitError: (error) => {
      for (const listener of listeners) {
        listener(error);
      }
    },
  };
}
