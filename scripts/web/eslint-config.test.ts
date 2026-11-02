// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect, test } from 'vitest';
import { webConfigs } from './eslint-config.ts';

const linter = new Linter();

/** The rule ids that fire for `code` as if it were the file `filename`, using the real web blocks. */
function violations(filename: string, code: string): string[] {
  const parser = { files: ['**/*.{ts,tsx}'], languageOptions: { parser: tseslint.parser } };
  return linter.verify(code, [parser, ...webConfigs], { filename }).map((message) => message.ruleId ?? 'parse-error');
}

const COMPONENT = 'src/web/Panel.tsx';

test.each([
  [
    'a hook called conditionally',
    "import { useState } from 'react';\nexport function Panel({ on }: { on: boolean }) {\n  if (on) {\n    useState(0);\n  }\n  return <p />;\n}",
    'react-hooks/rules-of-hooks',
  ],
  [
    'an effect that misses a dependency',
    "import { useEffect } from 'react';\nexport function Panel({ id }: { id: number }) {\n  useEffect(() => {\n    document.title = String(id);\n  }, []);\n  return <p />;\n}",
    'react-hooks/exhaustive-deps',
  ],
  [
    'state set while rendering',
    "import { useState } from 'react';\nexport function Panel() {\n  const [n, setN] = useState(0);\n  setN(n + 1);\n  return <p />;\n}",
    'react-hooks/set-state-in-render',
  ],
])('src/web may not have %s', (_what, code, rule) => {
  expect(violations(COMPONENT, code)).toContain(rule);
});

test('a component that follows the rules is clean', () => {
  const code =
    'import { useEffect, useState } from \'react\';\nexport function Panel({ id }: { id: number }) {\n  const [n, setN] = useState(0);\n  useEffect(() => {\n    document.title = String(id);\n  }, [id]);\n  return <button type="button" onClick={() => { setN(n + 1); }}>{n}</button>;\n}';
  expect(violations(COMPONENT, code)).toEqual([]);
});

test('the rules apply to src/web only: the same mistake elsewhere is not their business', () => {
  const code =
    "import { useState } from 'react';\nexport function panel(on: boolean) {\n  if (on) {\n    useState(0);\n  }\n}";
  expect(violations(COMPONENT, code)).toContain('react-hooks/rules-of-hooks');
  expect(violations('src/server/panel.ts', code)).toEqual([]);
});
