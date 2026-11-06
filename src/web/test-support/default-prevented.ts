// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { onTestFinished } from 'vitest';

// Whether a handler stopped the browser's own action for an event (E18 review). jsdom never reloads the page or follows a link, so a
// test that looks at the address after a submit or a click cannot tell a handler that called `preventDefault()` from one that did not;
// in a browser the form would reload with its fields in the address, and the export link would navigate away.

/** What the watch has seen: for every event of its type that reached the document, whether its default action was prevented. */
export interface DefaultWatch {
  /** In order, `true` for an event whose default action had been prevented by the time it reached the document. */
  readonly prevented: readonly boolean[];
}

/**
 * Starts recording the events of `type` (`submit` or `click`) that reach the document. React handles an event at the root of the app, before
 * it bubbles to the document, so by then the handler of the component has run. The watch ends with the test.
 */
export function watchDefault(type: 'submit' | 'click'): DefaultWatch {
  const prevented: boolean[] = [];
  const record = (event: Event) => {
    prevented.push(event.defaultPrevented);
  };
  document.addEventListener(type, record);
  onTestFinished(() => {
    document.removeEventListener(type, record);
  });
  return { prevented };
}
