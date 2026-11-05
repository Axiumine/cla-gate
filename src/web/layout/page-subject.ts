// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createContext, useContext, useEffect } from 'react';

// The part of a page title that only the page knows (E18-S04): the account whose installation is on screen. The route says its
// title from the catalog (route-access.ts); a page that has a subject of its own, which is text a person controls, hands it to the
// shell, which puts it in `document.title` and in the live region through `visibleText`, so a hostile name stays text there too.

/** Sets the subject of the page that is showing, or clears it with `undefined`. The shell provides it. */
type SetSubject = (subject: string | undefined) => void;

/** The shell provides the setter; a page rendered without a shell (a unit test of a component) sets nothing. */
export const PageSubjectContext = createContext<SetSubject>(() => undefined);

/**
 * Names what the page is about, for the title of the tab and the announcement of the page: `subject` while the page is mounted
 * and it is not `undefined`. The subject goes when the page does or when it changes, so no page shows another page's subject.
 */
export function usePageSubject(subject: string | undefined): void {
  const setSubject = useContext(PageSubjectContext);
  useEffect(() => {
    setSubject(subject);
    return () => {
      setSubject(undefined);
    };
  }, [setSubject, subject]);
}
