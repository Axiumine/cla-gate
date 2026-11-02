// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { collectIo, exists, readText } from '../ci/lib/test-support.ts';
import { makeRepo, tempDir } from '../code-caps/test-support.ts';
import { compareNames } from '../code-caps/types.ts';
import { main } from './cli.ts';
import type { FetchLike } from './download.ts';
import { RULESETS } from './rulesets.ts';
import { answering, listDir, perRuleset, RULE_FILE } from './test-support.ts';

// E20-S01: yarn semgrep:rules with an injected fetch and a temporary rules directory.

const SETS = RULESETS.length;

function rulesDirectory(): string {
  return path.join(tempDir(), 'rules');
}

test('every rule set is downloaded to rules/<name>.yaml, and the licence note is printed', async () => {
  const dir = rulesDirectory();
  const { io, out, err } = collectIo();
  const { fetchImpl, urls } = answering(RULE_FILE);
  expect(await main([], dir, io, fetchImpl)).toBe(0);
  expect(urls.toSorted(compareNames)).toEqual(
    RULESETS.map((name) => `https://semgrep.dev/c/p/${name}`).toSorted(compareNames),
  );
  expect(listDir(dir)).toEqual(RULESETS.map((name) => `${name}.yaml`).toSorted(compareNames));
  for (const name of RULESETS) {
    expect(readText(path.join(dir, `${name}.yaml`))).toBe(RULE_FILE);
  }
  expect(err).toEqual([]);
  expect(out).toEqual([
    `semgrep-rules ok: ${SETS} rule sets in ${dir}`,
    'semgrep-rules: rules/ stays git-ignored: the Semgrep Rules License v1.0 forbids redistribution, so never commit, upload or cache it outside this checkout',
  ]);
});

test('an HTTP 404 fails with exit code 1, names the rule set, and writes nothing', async () => {
  const dir = rulesDirectory();
  const { io, out, err } = collectIo();
  const ok = (): Response => new Response(RULE_FILE);
  const fetchImpl = perRuleset({ typescript: ok(), javascript: ok(), react: ok(), nodejsscan: ok() });
  expect(await main([], dir, io, fetchImpl)).toBe(1);
  expect(err).toEqual([
    'semgrep-rules: secrets: HTTP 404 from https://semgrep.dev/c/p/secrets',
    `semgrep-rules FAILED: 1 of ${SETS} rule sets not downloaded, nothing written`,
  ]);
  expect(out).toEqual([]);
  expect(exists(dir)).toBe(false);
});

test('a network error fails with exit code 1 and names the rule set', async () => {
  const dir = rulesDirectory();
  const { io, err } = collectIo();
  const ok = (): Response => new Response(RULE_FILE);
  const fetchImpl = perRuleset({
    typescript: ok(),
    javascript: ok(),
    react: new TypeError('fetch failed'),
    nodejsscan: ok(),
    secrets: ok(),
  });
  expect(await main([], dir, io, fetchImpl)).toBe(1);
  expect(err[0]).toBe('semgrep-rules: react: network error: fetch failed (https://semgrep.dev/c/p/react)');
  expect(err).toHaveLength(2);
  expect(exists(dir)).toBe(false);
});

test('every failing rule set gets its own line', async () => {
  const dir = rulesDirectory();
  const { io, err } = collectIo();
  const fetchImpl = perRuleset({ typescript: new Response(RULE_FILE), javascript: new Error('offline') });
  expect(await main([], dir, io, fetchImpl)).toBe(1);
  expect(err.slice(0, 4).map((line) => line.split(': ')[1])).toEqual(['javascript', 'react', 'nodejsscan', 'secrets']);
  expect(err.at(-1)).toBe(`semgrep-rules FAILED: 4 of ${SETS} rule sets not downloaded, nothing written`);
});

test('a failed run leaves the copy of an earlier run untouched', async () => {
  const dir = rulesDirectory();
  makeRepo(dir, { 'react.yaml': 'old copy\n' });
  const { io } = collectIo();
  const { fetchImpl } = answering('', 503);
  expect(await main([], dir, io, fetchImpl)).toBe(1);
  expect(readText(path.join(dir, 'react.yaml'))).toBe('old copy\n');
});

test('a successful run replaces an earlier copy and leaves no temporary file behind', async () => {
  const dir = rulesDirectory();
  makeRepo(dir, { 'react.yaml': 'old copy\n' });
  const { io } = collectIo();
  expect(await main([], dir, io, answering(RULE_FILE).fetchImpl)).toBe(0);
  expect(readText(path.join(dir, 'react.yaml'))).toBe(RULE_FILE);
  expect(listDir(dir).filter((name) => !name.endsWith('.yaml'))).toEqual([]);
});

test('a rules path that is a file fails with exit code 1 and says where it could not write', async () => {
  const blocked = path.join(tempDir(), 'rules');
  makeRepo(path.dirname(blocked), { rules: 'not a directory\n' });
  const { io, err } = collectIo();
  expect(await main([], blocked, io, answering(RULE_FILE).fetchImpl)).toBe(1);
  expect(err).toHaveLength(1);
  expect(err[0]?.startsWith(`semgrep-rules: cannot write ${blocked}: `)).toBe(true);
});

test('an argument is a usage error with exit code 2, and nothing is downloaded', async () => {
  const dir = rulesDirectory();
  const { io, err } = collectIo();
  let calls = 0;
  const fetchImpl: FetchLike = () => {
    calls += 1;
    return Promise.resolve(new Response(RULE_FILE));
  };
  expect(await main(['typescript'], dir, io, fetchImpl)).toBe(2);
  expect(err[0]).toMatch(/^semgrep-rules: Unexpected argument 'typescript'/);
  expect(err[1]).toBe('usage: node scripts/fetch-semgrep-rules.ts (no arguments)');
  expect(calls).toBe(0);
  expect(exists(dir)).toBe(false);
});

test('an unknown option is a usage error too, and a hostile argument cannot forge a log line', async () => {
  const { io, err } = collectIo();
  expect(await main(['--root'], rulesDirectory(), io, answering(RULE_FILE).fetchImpl)).toBe(2);
  expect(err[0]).toMatch(/^semgrep-rules: Unknown option '--root'/);
  const hostile = collectIo();
  expect(await main(['x\nsemgrep-rules ok'], rulesDirectory(), hostile.io, answering(RULE_FILE).fetchImpl)).toBe(2);
  expect(hostile.err[0]).toContain('x\\x0asemgrep-rules ok');
  expect(hostile.err[0]).not.toContain('\n');
});

test('a hostile directory name cannot forge a log line', async () => {
  const dir = path.join(tempDir(), 'rules\nsemgrep-rules ok');
  makeRepo(path.dirname(dir), { [path.basename(dir)]: 'x' });
  const { io, err } = collectIo();
  expect(await main([], dir, io, answering(RULE_FILE).fetchImpl)).toBe(1);
  expect(err[0]).toContain('rules\\x0asemgrep-rules ok');
  expect(err[0]).not.toContain('\n');
});
