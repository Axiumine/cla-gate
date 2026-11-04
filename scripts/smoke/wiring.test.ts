// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { activeLines, listDir, ROOT, repoText, SCRIPTS } from '../semgrep-rules/test-support.ts';
import { stackNames } from './names.ts';

// E19-S08: the files and scripts that wire the container smoke test into the repository.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test('yarn smoke runs the smoke project of Vitest with SMOKE=1, and yarn ci:smoke the clean-up helper', () => {
  expect(SCRIPTS.get('smoke')).toBe('SMOKE=1 vitest run --project smoke');
  expect(SCRIPTS.get('ci:smoke')).toBe('node scripts/ci/smoke.ts');
});

test('the smoke project reads tests/smoke only, starts one stack for all files, and runs the files one after the other', async () => {
  const { smokeProject, scriptsProject, serverProject, webProject } = await import('../../vitest.projects.ts');
  expect(smokeProject.test).toMatchObject({
    name: 'smoke',
    include: ['tests/smoke/**/*.test.ts'],
    globalSetup: ['tests/smoke/global-setup.ts'],
    fileParallelism: false,
  });
  const sample = 'tests/smoke/boot.test.ts';
  for (const other of [scriptsProject, serverProject, webProject]) {
    expect(other.test?.include?.some((pattern) => path.matchesGlob(sample, pattern))).toBe(false);
  }
});

/** The names of the projects vitest.config.ts has with SMOKE set to `value`. */
async function projectNames(value: string): Promise<string[]> {
  vi.resetModules();
  vi.stubEnv('SMOKE', value);
  const { default: config } = await import('../../vitest.config.ts');
  const named = z.object({ test: z.object({ name: z.string() }) });
  return (config.test?.projects ?? []).flatMap((project) => {
    const parsed = named.safeParse(project);
    return parsed.success ? [parsed.data.test.name] : [];
  });
}

test.each([[''], ['0'], ['true']])(
  'with SMOKE=%j the run has no smoke project, so yarn test and yarn coverage never start Docker',
  async (value) => {
    expect(await projectNames(value)).toEqual(['scripts', 'server', 'web']);
  },
);

test('with SMOKE=1 the smoke project joins the others', async () => {
  expect(await projectNames('1')).toEqual(['scripts', 'server', 'web', 'smoke']);
});

test('the coverage scope is src and scripts, so tests/smoke is outside it without any exclusion', async () => {
  vi.stubEnv('SMOKE', '');
  const { default: config } = await import('../../vitest.config.ts');
  const include = config.test?.coverage?.include ?? [];
  expect(include.some((pattern) => path.matchesGlob('tests/smoke/support.ts', pattern))).toBe(false);
  expect(include.some((pattern) => path.matchesGlob('scripts/smoke/stack.ts', pattern))).toBe(true);
});

test('the report directory of the logs is git-ignored, because the caps tool and the linters follow .gitignore', () => {
  expect(activeLines(repoText('.gitignore'))).toContain('reports/');
});

test('Knip finds the test files and the global setup, and the e2e TypeScript project covers tests/smoke', () => {
  const knip = z.object({ entry: z.array(z.string()) }).parse(JSON.parse(repoText('knip.json')));
  expect(knip.entry).toEqual(expect.arrayContaining(['tests/smoke/*.test.ts', 'tests/smoke/global-setup.ts']));
  const project = z.object({ include: z.array(z.string()) }).parse(JSON.parse(repoText('tsconfig.e2e.json')));
  expect(project.include).toContain('tests/smoke/**/*.ts');
});

/** The control flow a logic-free entry file must not have. */
const CONTROL_FLOW = /\b(if|else|for|while|do|switch|try|catch|throw)\b\s*[({]|\?\s|&&|\|\|/;

test.each([['tests/smoke/global-setup.ts'], ['scripts/ci/smoke.ts']])(
  '%s is logic-free: no branch, loop or error handling of its own',
  (file) => {
    const code = activeLines(repoText(file))
      .filter((line) => !line.startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(CONTROL_FLOW);
  },
);

/** The scenarios of E19-S12: each test file starts a stack of its own, under the scenario name that the file is called. */
const SCENARIOS = ['backup', 'configured', 'failure', 'tls'];

/** The test files of tests/smoke. */
function testFiles(): string[] {
  return listDir(path.join(ROOT, 'tests/smoke')).filter((name) => name.endsWith('.test.ts'));
}

test('the test files of tests/smoke are the four of the setup-mode stack and one per scenario that changes the state of its stack', () => {
  expect(testFiles()).toEqual([
    'backup.test.ts',
    'boot.test.ts',
    'compose-config.test.ts',
    'configured.test.ts',
    'failure.test.ts',
    'hardening.test.ts',
    'roles.test.ts',
    'tls.test.ts',
  ]);
});

test('every test file about the setup-mode stack connects to the stack of the global setup and starts none of its own', () => {
  const files = testFiles().filter((name) => !SCENARIOS.includes(name.replace('.test.ts', '')));
  expect(files).toEqual(['boot.test.ts', 'compose-config.test.ts', 'hardening.test.ts', 'roles.test.ts']);
  for (const file of files) {
    const text = repoText(`tests/smoke/${file}`);
    expect(text).toContain("from './support.ts'");
    expect(text).not.toContain('startStack');
    expect(text).not.toContain('ownStack');
  }
});

test.each(SCENARIOS.map((scenario) => [scenario]))(
  'the %s scenario starts one stack of its own, named for it, and never reaches the stack of the global setup',
  (scenario) => {
    const text = repoText(`tests/smoke/${scenario}.test.ts`);
    expect(text.match(/\bownStack\(/g)).toHaveLength(1);
    expect(text).toContain(`scenario: '${scenario}'`);
    expect(text).toContain("from './scenario.ts'");
    expect(text).not.toMatch(/\binject\(|import \{[^}]*\bstack\b[^}]*\} from '\.\/support\.ts'/);
    expect(() => stackNames('cla-smoke-1-1', scenario)).not.toThrow();
  },
);

test('no two scenarios share a name, and none is called boot, the name of the stack of the global setup', () => {
  expect(new Set(SCENARIOS).size).toBe(SCENARIOS.length);
  expect(SCENARIOS).not.toContain('boot');
  expect(repoText('tests/smoke/global-setup.ts')).toContain("scenario: 'boot'");
});

test('the helper of the scenarios starts the stack before the first test of a file and takes it down after the last, even when a test failed', () => {
  const helper = activeLines(repoText('tests/smoke/scenario.ts')).join('\n');
  expect(helper).toContain('beforeAll(');
  expect(helper).toContain('afterAll(');
  expect(helper).toMatch(/afterAll\(async \(\) => \{\s*await started\?\.down\(\);/);
});

test('the tls scenario takes both public ports of Caddy from the stack, which draws them above 32768, and binds them to loopback', () => {
  const scenario = repoText('tests/smoke/tls.test.ts');
  const compose = repoText('docker-compose.yml');
  expect(scenario).toContain("profiles: ['tls']");
  expect(scenario).toContain("ports: ['CADDY_HTTP_PORT', 'CADDY_HTTPS_PORT']");
  expect(scenario).toContain("CADDY_BIND_ADDRESS: '127.0.0.1'");
  expect(compose).toContain(`\${CADDY_HTTP_PORT:-80}:80`);
  expect(compose).toContain(`\${CADDY_HTTPS_PORT:-443}:443`);
  // No setting of the scenario names a port: the ports are drawn, so 80 and 443 are never asked for.
  expect(scenario).not.toMatch(/CADDY_HTTPS?_PORT: /);
  expect(scenario).toMatch(/toBeGreaterThanOrEqual\(MIN_PORT\)/);
  expect(scenario).toContain('const MIN_PORT = 32_769;');
});

test('the failure scenario starts with the database only, so that two migrations race on an empty database', () => {
  const scenario = repoText('tests/smoke/failure.test.ts');
  expect(scenario).toContain("services: ['postgres']");
  expect(scenario.indexOf('two migrate runs')).toBeLessThan(scenario.indexOf('the rest of the stack starts'));
});
