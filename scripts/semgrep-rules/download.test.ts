// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { type Download, downloadRuleset, type FetchLike } from './download.ts';
import { RULESETS, rulesetFile, rulesetUrl } from './rulesets.ts';
import { answering, RULE_FILE } from './test-support.ts';

/** Why a download failed; empty for one that worked. */
function reasonOf(download: Download): string {
  return download.ok ? '' : download.reason;
}

// E20-S01: the download of one rule set, with an injected fetch.

test('the rule sets are the five of the semgrep script, served from the registry and saved as <name>.yaml', () => {
  expect(RULESETS).toEqual(['typescript', 'javascript', 'react', 'nodejsscan', 'secrets']);
  expect(RULESETS.map(rulesetUrl)).toEqual([
    'https://semgrep.dev/c/p/typescript',
    'https://semgrep.dev/c/p/javascript',
    'https://semgrep.dev/c/p/react',
    'https://semgrep.dev/c/p/nodejsscan',
    'https://semgrep.dev/c/p/secrets',
  ]);
  expect(RULESETS.map(rulesetFile)).toEqual([
    'typescript.yaml',
    'javascript.yaml',
    'react.yaml',
    'nodejsscan.yaml',
    'secrets.yaml',
  ]);
});

test('a rule file is returned as it came, from the registry URL, as YAML, with redirects refused and a deadline', async () => {
  const seen: { url: string; redirect: string; headers: unknown; signal: AbortSignal }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    seen.push({ url, redirect: init.redirect, headers: init.headers, signal: init.signal });
    return Promise.resolve(new Response(RULE_FILE));
  };
  expect(await downloadRuleset('react', fetchImpl)).toEqual({ ok: true, name: 'react', body: RULE_FILE });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.url).toBe('https://semgrep.dev/c/p/react');
  expect(seen[0]?.redirect).toBe('error');
  expect(seen[0]?.headers).toEqual({ accept: 'text/yaml', 'accept-encoding': 'identity' });
  expect(seen[0]?.signal).toBeInstanceOf(AbortSignal);
  expect(seen[0]?.signal.aborted).toBe(false);
});

test.each([
  [404, 'HTTP 404 from https://semgrep.dev/c/p/missing'],
  [403, 'HTTP 403 from https://semgrep.dev/c/p/missing'],
  [500, 'HTTP 500 from https://semgrep.dev/c/p/missing'],
])('an HTTP %i answer is a failure that names the URL and never keeps the body', async (status, reason) => {
  const { fetchImpl } = answering(RULE_FILE, status);
  expect(await downloadRuleset('missing', fetchImpl)).toEqual({ ok: false, name: 'missing', reason });
});

test('a network error is a failure that carries the error message and the URL', async () => {
  const fetchImpl: FetchLike = () => Promise.reject(new TypeError('fetch failed'));
  expect(await downloadRuleset('secrets', fetchImpl)).toEqual({
    ok: false,
    name: 'secrets',
    reason: 'network error: fetch failed (https://semgrep.dev/c/p/secrets)',
  });
});

test('control characters in an error message are escaped, so a message cannot forge a log line', async () => {
  const fetchImpl: FetchLike = () => Promise.reject(new Error('boom\u001b[31m'));
  const result = await downloadRuleset('react', fetchImpl);
  expect(result).toMatchObject({ ok: false, reason: 'network error: boom\\x1b[31m (https://semgrep.dev/c/p/react)' });
});

test('a body that cannot be read to the end is a network error', async () => {
  const fetchImpl: FetchLike = () =>
    Promise.resolve({ ok: true, status: 200, text: () => Promise.reject(new Error('terminated')) });
  expect(await downloadRuleset('react', fetchImpl)).toEqual({
    ok: false,
    name: 'react',
    reason: 'network error: terminated (https://semgrep.dev/c/p/react)',
  });
});

test('a request that never answers ends at the deadline, as a network error', async () => {
  const hang: FetchLike = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        try {
          init.signal.throwIfAborted();
        } catch (error) {
          reject(error instanceof Error ? error : new Error('aborted'));
        }
      });
    });
  const result = await downloadRuleset('react', hang, 20);
  expect(result.ok).toBe(false);
  expect(reasonOf(result)).toContain('network error: ');
  expect(reasonOf(result)).toContain('aborted due to timeout');
});

test.each([
  ['an HTML page', '<!doctype html><title>Sign in</title>', 'not a Semgrep rule file (no rules list with ids)'],
  ['an empty body', '', 'not a Semgrep rule file (no rules list with ids)'],
  ['a mapping without rules', 'name: demo\n', 'not a Semgrep rule file (no rules list with ids)'],
  ['an empty rules list', 'rules: []\n', 'not a Semgrep rule file (no rules list with ids)'],
  ['a rule without an id', 'rules:\n- message: demo\n', 'not a Semgrep rule file (no rules list with ids)'],
  ['a rule with an empty id', "rules:\n- id: ''\n", 'not a Semgrep rule file (no rules list with ids)'],
])('%s is refused with a 200 answer', async (_label, body, problem) => {
  const { fetchImpl } = answering(body);
  expect(await downloadRuleset('react', fetchImpl)).toEqual({
    ok: false,
    name: 'react',
    reason: `${problem} (https://semgrep.dev/c/p/react)`,
  });
});

test('a body that is not YAML is refused with the first line of the parser message only', async () => {
  const { fetchImpl } = answering('rules: [\n- id: a\n: : :\n');
  const result = await downloadRuleset('react', fetchImpl);
  expect(result.ok).toBe(false);
  const reason = reasonOf(result);
  expect(reason).toMatch(/^not valid YAML: .+ \(https:\/\/semgrep\.dev\/c\/p\/react\)$/);
  expect(reason).not.toContain('\n');
});
