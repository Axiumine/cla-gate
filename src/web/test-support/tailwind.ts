// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { compile } from 'tailwindcss';

// The styles of a rendered component, for the tests that assert on a computed style (E17-S11). jsdom has no stylesheet
// unless one is put in the page, and no layout at all, so the only layout claim a test can check is the CSS a class stands
// for. The classes are turned into CSS by Tailwind's own compiler, so the test and the build agree on what `wrap-anywhere` is.
// Only the utilities that need no theme value are produced here (`sr-only`, `wrap-anywhere`, `absolute`...): the theme of
// the app is app.css's, and its tokens are asserted by the token tests (E17-S05).

/** Every class name used by `root` and the elements inside it, without repeats. */
export function classNamesIn(root: Element): string[] {
  const names = new Set<string>();
  for (const element of [root, ...root.querySelectorAll('[class]')]) {
    for (const name of element.classList) {
      names.add(name);
    }
  }
  return [...names];
}

/** The CSS Tailwind writes for these class names; a name it does not know produces nothing. */
export async function utilitiesFor(classNames: readonly string[]): Promise<string> {
  const compiler = await compile('@tailwind utilities;');
  return compiler.build([...classNames]);
}

/**
 * Puts the CSS of every class used under `root` into the page as a `<style>` element, so `getComputedStyle` sees it. Returns
 * a function that takes the element out again.
 */
export async function applyUtilitiesOf(root: Element): Promise<() => void> {
  const style = document.createElement('style');
  style.textContent = await utilitiesFor(classNamesIn(root));
  document.head.append(style);
  return () => {
    style.remove();
  };
}
