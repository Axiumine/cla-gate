// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type AtRule, parse, type Root } from 'postcss';

// Reading a stylesheet the way a browser's parser sees it, for the tests of the design tokens (E17-S05): comments and
// strings cannot fool it the way a regular expression over the text can.

export function parseCss(text: string): Root {
  return parse(text);
}

/**
 * The declarations of every rule that has `selector` among its selectors, wherever it sits (inside an at-rule too), as a
 * name-to-value map; a later declaration of the same name overrides an earlier one.
 */
export function declarationsOf(root: Root, selector: string): Map<string, string> {
  const found = new Map<string, string>();
  root.walkRules((rule) => {
    if (rule.selectors.includes(selector)) {
      rule.each((node) => {
        if (node.type === 'decl') {
          found.set(node.prop, node.value);
        }
      });
    }
  });
  return found;
}

/** Every at-rule called `name`, with the given `params` when one is passed (`media` and `(forced-colors: active)`). */
export function atRulesOf(root: Root, name: string, params?: string): AtRule[] {
  const found: AtRule[] = [];
  root.walkAtRules(name, (atRule) => {
    if (params === undefined || atRule.params === params) {
      found.push(atRule);
    }
  });
  return found;
}

/** The two themes of a tokens file: `light` is :root, `dark` is :root with the overrides of :root[data-theme="dark"]. */
export interface ThemeTokens {
  readonly light: ReadonlyMap<string, string>;
  readonly dark: ReadonlyMap<string, string>;
  /** Only what the dark rule sets. */
  readonly darkOverrides: ReadonlyMap<string, string>;
}

export function themeTokens(css: string): ThemeTokens {
  const root = parseCss(css);
  const light = declarationsOf(root, ':root');
  const darkOverrides = declarationsOf(root, ':root[data-theme="dark"]');
  return { light, dark: new Map([...light, ...darkOverrides]), darkOverrides };
}

/** The custom properties among declarations, whose value is a `#rrggbb` colour: the colour tokens. */
export function colourTokens(declarations: ReadonlyMap<string, string>): Map<string, string> {
  return new Map([...declarations].filter(([name, value]) => name.startsWith('--') && /^#[\da-f]{6}$/i.test(value)));
}
