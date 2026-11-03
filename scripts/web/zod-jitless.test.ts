// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';
import { ROOT, repoText } from '../semgrep-rules/test-support.ts';

// E17-S03: the page's Content-Security-Policy has no `unsafe-eval`, and Zod 4 probes `new Function('')` when it builds its
// first object schema. The probe is caught, but the browser reports it as a `securitypolicyviolation` on every page load, which
// the end-to-end run of E18-S12 asserts there are none of. src/web/zod-config.ts turns the probe off (`jitless`), and Zod reads
// that setting when each schema is built, so the module must run before any module that builds one. Each case runs in a fresh
// Node process (Zod caches the probe's answer), with `Function` replaced by a counter before anything is imported.

/** Counts the constructions of `Function` while the modules named by the arguments are imported, in order, and prints the count. */
const COUNT_FUNCTION_CONSTRUCTIONS = `
let constructed = 0;
const Native = globalThis.Function;
globalThis.Function = new Proxy(Native, {
  construct(target, args, newTarget) { constructed += 1; return Reflect.construct(target, args, newTarget); },
  apply(target, self, args) { constructed += 1; return Reflect.apply(target, self, args); },
});
for (const url of process.argv.slice(1)) { await import(url); }
process.stdout.write(String(constructed));
`;

const SHARED_DIRECTORY = path.join(ROOT, 'src/shared');
const ZOD_CONFIG = path.join(ROOT, 'src/web/zod-config.ts');

/** The modules of src/shared (their paths), which build the schemas the app imports once the entry has run. */
function sharedModules(): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: the fixed directory src/shared of this repository
  return fs
    .readdirSync(SHARED_DIRECTORY)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'test-support.ts')
    .toSorted((a, b) => a.localeCompare(b))
    .map((name) => path.join(SHARED_DIRECTORY, name));
}

/** How many times `Function` is constructed while `files` are imported in a new process. */
function constructions(files: readonly string[]): number {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', COUNT_FUNCTION_CONSTRUCTIONS, ...files.map((file) => pathToFileURL(file).href)],
    { encoding: 'utf8', cwd: ROOT },
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return Number(result.stdout);
}

test('without the setting, building the schemas of src/shared constructs a Function: the probe this guards against', () => {
  expect(constructions(sharedModules())).toBeGreaterThan(0);
});

test('with zod-config.ts imported first, building the schemas of src/shared constructs no Function', () => {
  expect(constructions([ZOD_CONFIG, ...sharedModules()])).toBe(0);
});

test('the setting comes too late when a module that builds a schema is imported before it', () => {
  const [first = ''] = sharedModules();
  expect(constructions([first, ZOD_CONFIG])).toBeGreaterThan(0);
});

test('zod-config.ts is the first import of main.tsx, so it runs before the app and src/shared are loaded', () => {
  const imports = repoText('src/web/main.tsx')
    .split('\n')
    .filter((line) => line.startsWith('import '));
  expect(imports[0]).toBe("import './zod-config.ts';");
});
