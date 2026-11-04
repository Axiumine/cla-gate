// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { exists, readText } from '../ci/lib/test-support.ts';
import { argsOf, type Instruction, ROOT, readDockerfile, type Stage, stageNamed } from './test-support.ts';

// E19-S01: what the Dockerfile promises, read from its instructions (comments and blank lines are not instructions). The
// image itself is built and run by hand for this story (the commit message records it) and by the smoke test of E19-S08.

const dockerfile = readDockerfile();
const stage = (name: string): Stage => stageNamed(dockerfile, name);
const text = (instructions: readonly Instruction[]): string[] =>
  instructions.map(({ keyword, args }) => `${keyword} ${args}`);
const nvmrc = readText(path.join(ROOT, '.nvmrc')).trim();
/** How the Dockerfile refers to the build argument; kept apart so that no string literal here looks like an unfilled template. */
const COMMIT_REF = `\${SOURCE_COMMIT}`;
const NODE_IMAGE = /^node:\$\{NODE_VERSION\}-(?:bookworm|trixie)-slim@sha256:[0-9a-f]{64}$/;

test('ARG NODE_VERSION is the version of .nvmrc, and it is the only instruction before the first stage', () => {
  expect(nvmrc).toMatch(/^\d+\.\d+\.\d+$/);
  expect(text(dockerfile.header)).toEqual([`ARG NODE_VERSION=${nvmrc}`]);
});

test('the stages are base, deps, build, prod-deps and runtime, and runtime is the last one', () => {
  expect(dockerfile.stages.map(({ name }) => name)).toEqual(['base', 'deps', 'build', 'prod-deps', 'runtime']);
});

test('the only image from a registry is the official Node image, Debian slim, by exact tag and digest', () => {
  const names = dockerfile.stages.map(({ name }) => name);
  const registry = dockerfile.stages.filter(({ from }) => !names.includes(from));
  expect(registry.map(({ name, from }) => [name, NODE_IMAGE.test(from)])).toEqual([['base', true]]);
});

test('every other stage starts from an earlier stage: deps and runtime from base, build and prod-deps from deps', () => {
  expect(dockerfile.stages.map(({ name, from }) => `${name} < ${from.startsWith('node:') ? 'node' : from}`)).toEqual([
    'base < node',
    'deps < base',
    'build < deps',
    'prod-deps < deps',
    'runtime < base',
  ]);
});

test('deps installs Corepack, copies only the three lockfile inputs and installs from the lockfile without build scripts', () => {
  const { instructions } = stage('deps');
  expect(text(instructions).filter((line) => !line.startsWith('ENV '))).toEqual([
    'RUN npm install -g corepack@0.36.0 && corepack enable',
    'COPY package.json yarn.lock .yarnrc.yml ./',
    'RUN yarn install --immutable --mode=skip-build',
  ]);
});

/** True for a COPY from the build context whose sources include the whole context (`.` or `./`); `--from` copies are from a stage. */
function copiesWholeContext(args: string): boolean {
  const words = args.split(' ');
  const sources = words.filter((word) => !word.startsWith('--')).slice(0, -1);
  return !words.some((word) => word.startsWith('--from=')) && sources.some((source) => ['.', './'].includes(source));
}

test('build copies the whole context and runs yarn build; no other stage copies the context', () => {
  expect(text(stage('build').instructions)).toEqual(['COPY . .', 'RUN yarn build']);
  const copiesContext = dockerfile.stages
    .filter((candidate) => argsOf(candidate, 'COPY').some(copiesWholeContext))
    .map(({ name }) => name);
  expect(copiesContext).toEqual(['build']);
});

test.each([
  ['COPY . .', true],
  ['COPY --chown=1:1 ./ /app/', true],
  ['COPY package.json yarn.lock ./', false],
  ['COPY --from=build . .', false],
])('the rule for copying the whole context sees %j as %s', (args, expected) => {
  expect(copiesWholeContext(args.replace('COPY ', ''))).toBe(expected);
});

test('prod-deps installs the production dependencies only and copies nothing, so a source change does not reach it', () => {
  expect(text(stage('prod-deps').instructions)).toEqual([
    'RUN npm pkg delete scripts.postinstall && yarn workspaces focus --all --production',
  ]);
});

test('runtime holds dist, the production node_modules, migrations, package.json and LICENSE, all taken from a build stage', () => {
  expect(argsOf(stage('runtime'), 'COPY')).toEqual([
    '--from=prod-deps /app/node_modules ./node_modules',
    '--from=build /app/dist ./dist',
    '--from=build /app/migrations ./migrations',
    '--from=build /app/package.json /app/LICENSE ./',
  ]);
});

test('runtime runs nothing: no Yarn, no Corepack, no install, no shell step at all', () => {
  expect(argsOf(stage('runtime'), 'RUN')).toEqual([]);
  expect(text(stage('runtime').instructions).join('\n')).not.toMatch(/yarn|corepack|apt-get|npm /i);
});

test('the image runs as the numeric user 10001:10001, set after the last COPY, and nothing is chowned to it', () => {
  const { instructions } = stage('runtime');
  const keywords = instructions.map(({ keyword }) => keyword);
  expect(argsOf(stage('runtime'), 'USER')).toEqual(['10001:10001']);
  expect(keywords.lastIndexOf('COPY')).toBeLessThan(keywords.indexOf('USER'));
  expect(text(instructions).join('\n')).not.toMatch(/--chown|--chmod|chown |chmod /);
});

test('the environment of the image: production, all interfaces inside the container, port 3000 and the commit', () => {
  expect(argsOf(stage('runtime'), 'ARG')).toEqual(['SOURCE_COMMIT=unknown']);
  expect(argsOf(stage('runtime'), 'ENV')).toEqual([
    `NODE_ENV=production HOST=0.0.0.0 PORT=3000 SOURCE_COMMIT=${COMMIT_REF}`,
  ]);
  expect(argsOf(stage('runtime'), 'EXPOSE')).toEqual(['3000']);
});

test('the start command is the server in exec form, and there is no ENTRYPOINT, so the migration service can replace the command', () => {
  const [cmd = ''] = argsOf(stage('runtime'), 'CMD');
  expect(JSON.parse(cmd)).toEqual(['node', 'dist/server/main.js']);
  expect(argsOf(stage('runtime'), 'ENTRYPOINT')).toEqual([]);
});

test('the HEALTHCHECK runs node dist/server/healthcheck.js with the intervals of the story', () => {
  expect(argsOf(stage('runtime'), 'HEALTHCHECK')).toHaveLength(1);
  const [args = ''] = argsOf(stage('runtime'), 'HEALTHCHECK');
  const [flags = '', command = ''] = args.split(' CMD ');
  expect(flags).toBe('--interval=15s --timeout=3s --start-period=20s --retries=3');
  expect(JSON.parse(command)).toEqual(['node', 'dist/server/healthcheck.js']);
});

test('the commands of the image are entry points of the source, which yarn build compiles into dist/server', () => {
  for (const entry of ['main', 'migrate', 'healthcheck']) {
    expect(exists(path.join(ROOT, 'src/server', `${entry}.ts`))).toBe(true);
  }
});

/** The `key="value"` pairs of a LABEL instruction: split on the quotes, so that keys are at even and values at odd positions. */
function labelPairs(args: string): [string, string][] {
  const parts = args.split('"');
  return parts.flatMap((part, index): [string, string][] =>
    index % 2 === 0 && part.trim() !== '' ? [[part.trim().replace(/=$/, ''), parts[index + 1] ?? '']] : [],
  );
}

test('the OCI labels name the title, the source, the revision and the licence; SOURCE_URL is not baked in', () => {
  expect(Object.fromEntries(labelPairs(argsOf(stage('runtime'), 'LABEL').join(' ')))).toEqual({
    'org.opencontainers.image.title': 'cla-gate',
    'org.opencontainers.image.source': 'https://github.com/Axiumine/cla-gate',
    'org.opencontainers.image.revision': COMMIT_REF,
    'org.opencontainers.image.licenses': 'AGPL-3.0-only',
  });
  const all = dockerfile.stages.flatMap(({ instructions }) => text(instructions)).join('\n');
  expect(all).not.toContain('SOURCE_URL');
});

test('no ARG or ENV of the image names a secret, so none can be baked into a layer', () => {
  const settings = [...dockerfile.header, ...dockerfile.stages.flatMap(({ instructions }) => instructions)].filter(
    ({ keyword }) => ['ARG', 'ENV'].includes(keyword),
  );
  expect(text(settings).filter((line) => /SECRET|PASSWORD|TOKEN|PRIVATE_KEY|DATABASE_URL|_FILE/i.test(line))).toEqual(
    [],
  );
});

test('the Dockerfile has no .trivyignore entry: the misconfiguration pass is clean without one', () => {
  const ignored = readText(path.join(ROOT, '.trivyignore'))
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));
  expect(ignored.filter((line) => /^(?:AVD-)?DS-?\d+/i.test(line))).toEqual([]);
});
