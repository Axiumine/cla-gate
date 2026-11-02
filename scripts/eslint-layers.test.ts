// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect, test } from 'vitest';
import { layerConfigs } from './eslint-layers.ts';

const linter = new Linter();

/** The rule ids that fire for `code` as if it were the file `filename`, using the real layer blocks. */
function violations(filename: string, code: string): string[] {
  const parser = { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } };
  return linter.verify(code, [parser, ...layerConfigs], { filename }).map((message) => message.ruleId ?? 'parse-error');
}

const DOMAIN = 'src/server/domain/evaluate.ts';
const DOMAIN_TEST = 'src/server/domain/evaluation/types.test.ts';
const SHARED = 'src/shared/health.ts';
const WEB = 'src/web/main.ts';
const SERVER = 'src/server/app.ts';
const IMPORT = 'no-restricted-imports';
const SYNTAX = 'no-restricted-syntax';
const GLOBAL = 'no-restricted-globals';
const PROPERTY = 'no-restricted-properties';

test.each([
  ['its own file', DOMAIN, "import { x } from './coverage.ts';"],
  ['a type from its own file', DOMAIN, "import type { X } from './sub/types.ts';"],
  ['src/shared', DOMAIN, "import { errorResponseSchema } from '../../shared/errors.ts';"],
  ['zod', DOMAIN, "import { z } from 'zod';"],
  ['a re-export of its own file', DOMAIN, "export { x } from './coverage.ts';"],
  ['a package that merely ends in /web, from src/server', SERVER, "import { ReadableStream } from 'node:stream/web';"],
  ['a package that merely ends in /web, from src/shared', SHARED, "import { ReadableStream } from 'node:stream/web';"],
  ['react-dom/server from src/web', WEB, "import { renderToString } from 'react-dom/server';"],
  ['a sibling file from src/shared', SHARED, "import { x } from './errors.ts';"],
  ['src/shared from src/web', WEB, "import { x } from '../shared/errors.ts';"],
  ['src/shared from src/server', SERVER, "import { x } from '../shared/errors.ts';"],
  ['a dynamic import of a shared file', WEB, "export const lazy = () => import('../shared/errors.ts');"],
  ['a file whose name only starts with "web"', SERVER, "import { x } from './webhooks.ts';"],
  ['a directory whose name only starts with "server"', SHARED, "import { x } from '../servers/x.ts';"],
  ['the test runner from a domain test file', DOMAIN_TEST, "import { expect, test } from 'vitest';"],
  ['a sibling file from a domain test file', DOMAIN_TEST, "import { account } from './test-support.ts';"],
  ['src/shared from a domain test file', DOMAIN_TEST, "import { x } from '../../../shared/errors.ts';"],
  ['Math.floor and Math.max in the domain', DOMAIN, 'export const n = Math.max(Math.floor(1.5), 0);'],
  ['a local variable that shadows a clock global', DOMAIN, 'export const f = (Date: number) => Date + 1;'],
  ['a dynamic import of such a file', SERVER, "export const lazy = () => import('./web-hooks.ts');"],
])('allowed: %s', (_what, filename, code) => {
  expect(violations(filename, code)).toEqual([]);
});

test.each([
  ['an I/O built-in', "import fs from 'node:fs';", IMPORT],
  ['an I/O built-in without the node: prefix', "import { readFile } from 'fs/promises';", IMPORT],
  ['dns/promises', "import { lookup } from 'dns/promises';", IMPORT],
  ['node:dns/promises', "import { lookup } from 'node:dns/promises';", IMPORT],
  ['a built-in nobody listed (node:sqlite)', "import { DatabaseSync } from 'node:sqlite';", IMPORT],
  ['a built-in nobody listed (node:worker_threads)', "import { Worker } from 'node:worker_threads';", IMPORT],
  ['createRequire', "import { createRequire } from 'node:module';", IMPORT],
  ['process through an import', "import process from 'node:process';", IMPORT],
  ['an I/O library', "import { Kysely } from 'kysely';", IMPORT],
  ['a scoped I/O library', "import helmet from '@fastify/helmet';", IMPORT],
  ['the composition root', "import { buildApp } from '../app.ts';", IMPORT],
  ['the boot module', "import { boot } from '../boot.ts';", IMPORT],
  ['the configuration', "import { loadConfig } from '../config/env.ts';", IMPORT],
  ['an adapter', "import { createPgDatabase } from '../adapters/db/pg.ts';", IMPORT],
  ['a service', "import { x } from '../services/x.ts';", IMPORT],
  ['an adapter reached through ./', "import { x } from './../adapters/db/pg.ts';", IMPORT],
  ['an adapter reached through src/shared', "import { x } from '../../shared/../server/adapters/x.ts';", IMPORT],
  ['src/web', "import { x } from '../../web/main.ts';", IMPORT],
  ['a re-export of an I/O module', "export * from 'node:fs';", IMPORT],
  ['a dynamic import of a built-in', "export const lazy = () => import('node:fs');", SYNTAX],
  ['a dynamic import of its own file', "export const lazy = () => import('./coverage.ts');", SYNTAX],
  ['a computed dynamic import', 'export const lazy = (name: string) => import(name);', SYNTAX],
  ['fetch', "export const get = () => fetch('https://example.org');", GLOBAL],
  ['process', 'export const home = process.env;', GLOBAL],
  ['require', "export const fs = require('node:fs');", GLOBAL],
  ['fetch through globalThis', "export const get = () => globalThis.fetch('https://example.org');", SYNTAX],
  ['process through global', 'export const home = global.process;', SYNTAX],
  ['new Date()', 'export const now = new Date();', GLOBAL],
  ['Date.now()', 'export const now = Date.now();', GLOBAL],
  ['Date through globalThis', 'export const now = globalThis.Date.now();', SYNTAX],
  ['Temporal.Now', 'export const now = Temporal.Now.instant();', GLOBAL],
  ['performance.now()', 'export const t = performance.now();', GLOBAL],
  ['crypto.randomUUID()', 'export const id = crypto.randomUUID();', GLOBAL],
  ['Math.random()', 'export const r = Math.random();', PROPERTY],
  ['Math["random"]()', "export const r = Math['random']();", PROPERTY],
  ['Math.random through destructuring', 'export const { random } = Math;', PROPERTY],
])('the domain layer may not use %s', (_what, code, rule) => {
  expect(violations(DOMAIN, code)).toContain(rule);
});

test.each([
  ['the test runner from a domain source file', DOMAIN, "import { test } from 'vitest';"],
  [
    'the test runner from a domain helper',
    'src/server/domain/evaluation/test-support.ts',
    "import { vi } from 'vitest';",
  ],
  ['a package that only starts with vitest', DOMAIN_TEST, "import { x } from 'vitest-extra';"],
  ['a sub-path of vitest', DOMAIN_TEST, "import { x } from 'vitest/node';"],
  ['a Node built-in from a domain test file', DOMAIN_TEST, "import { readFile } from 'node:fs/promises';"],
  ['an adapter from a domain test file', DOMAIN_TEST, "import { x } from '../../adapters/db/pg.ts';"],
  ['a parent directory of the domain from a test file', DOMAIN_TEST, "import { x } from '../app.ts';"],
  ['an I/O library from a domain test file', DOMAIN_TEST, "import { Kysely } from 'kysely';"],
])('domain imports: %s is refused', (_what, filename, code) => {
  expect(violations(filename, code)).toContain(IMPORT);
});

test.each([
  ['a service', "import { x } from '../../services/ports/github.ts';"],
  ['an adapter', "import { x } from '../../adapters/github/client.ts';"],
  ['src/web', "import { x } from '../../../web/main.ts';"],
  ['a Node built-in', "import { randomUUID } from 'node:crypto';"],
])('the evaluation engine (src/server/domain/evaluation) may not import %s', (_what, code) => {
  expect(violations('src/server/domain/evaluation/evaluate.ts', code)).toContain(IMPORT);
});

test.each([
  ['process', 'export const home = process.env;', GLOBAL],
  ['new Date()', 'export const now = new Date();', GLOBAL],
  ['Math.random()', 'export const r = Math.random();', PROPERTY],
  ['a dynamic import()', "export const lazy = () => import('./types.ts');", SYNTAX],
  ['the global object', 'export const now = globalThis.Date;', SYNTAX],
])('a domain test file may not use %s either', (_what, code, rule) => {
  expect(violations(DOMAIN_TEST, code)).toContain(rule);
});

test.each([
  ['src/server', SHARED, "import { x } from '../server/app.ts';"],
  ['src/server through more ../', SHARED, "import { x } from '../../server/adapters/db/pg.ts';"],
  ['src/web', SHARED, "import { x } from '../web/main.ts';"],
  ['src/server from src/web', WEB, "import { x } from '../server/app.ts';"],
  ['src/web from src/server', SERVER, "import { x } from '../web/main.ts';"],
  [
    'src/web from a nested src/server file',
    'src/server/adapters/http/x.ts',
    "import { x } from '../../../web/main.ts';",
  ],
  ['a re-export of src/server', SHARED, "export { x } from '../server/app.ts';"],
])('static import of %s is refused (%s)', (_what, filename, code) => {
  expect(violations(filename, code)).toContain(IMPORT);
});

test.each([
  ['src/server from src/shared', SHARED, "export const lazy = () => import('../server/app.ts');"],
  ['src/server from src/web', WEB, "export const lazy = () => import('../server/app.ts');"],
  ['src/web from src/shared', SHARED, "export const lazy = () => import('../web/main.ts');"],
  ['src/web from src/server', SERVER, "export const lazy = () => import('../web/main.ts');"],
  ['a computed path from src/shared', SHARED, 'export const lazy = (name: string) => import(name);'],
  ['a computed path from src/web', WEB, 'export const lazy = (name: string) => import(name);'],
  ['a computed path from src/server', SERVER, 'export const lazy = (name: string) => import(name);'],
  ['a template path from src/server', SERVER, `export const lazy = (name: string) => import(\`../web/\${name}.ts\`);`],
])('dynamic import() of %s is refused (%s)', (_what, filename, code) => {
  expect(violations(filename, code)).toContain(SYNTAX);
});

test('a file outside the layered directories is not restricted', () => {
  expect(
    violations('scripts/tool.ts', "import fs from 'node:fs'; export const f = () => import('../src/server/app.ts');"),
  ).toEqual([]);
});
