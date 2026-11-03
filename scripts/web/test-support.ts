// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import vm from 'node:vm';

// Helpers shared by the tests of scripts/web.

/** A page as the theme script finds it: what `cla.theme` holds, whether the system is dark, whether storage throws. */
export interface ThemePage {
  readonly stored: string | null;
  readonly dark: boolean;
  readonly throws?: boolean;
}

/** The `data-theme` the script leaves on <html> when it runs on the page, or undefined when it sets none. */
export function themeAfterRunning(code: string, page: ThemePage): string | undefined {
  const attributes = new Map<string, string>();
  const sandbox = {
    window: { matchMedia: (query: string) => ({ matches: page.dark && query === '(prefers-color-scheme: dark)' }) },
    document: { documentElement: { setAttribute: (name: string, value: string) => attributes.set(name, value) } },
    localStorage: {
      getItem: (key: string) => {
        if (page.throws === true) {
          throw new Error('denied');
        }
        return new Map([['cla.theme', page.stored]]).get(key) ?? null;
      },
    },
  };
  // eslint-disable-next-line sonarjs/code-eval -- test: runs the script that the build emitted, in a sandbox that holds fakes of window, document and localStorage, to prove it works as a classic script
  new vm.Script(code).runInNewContext(sandbox);
  return attributes.get('data-theme');
}
