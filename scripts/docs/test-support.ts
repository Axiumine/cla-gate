// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { readText } from '../ci/lib/test-support.ts';

// Reading the operator guides of docs/operations/ for the tests that keep them true (E19-S09): the text without its code
// fences, the headings, the sections, the fenced blocks and the links, so that a test asserts on the structure of a guide and
// not on a line number.

export const ROOT = path.resolve(import.meta.dirname, '../..');

/** The eight guides the story names, by file name without the extension. */
export const GUIDES = [
  'install',
  'reverse-proxy',
  'upgrade',
  'backup-restore',
  'key-rotation',
  'troubleshooting',
  'uninstall',
  'data-protection',
] as const;

/** The path of a guide, from the root of the repository. */
export function guidePath(name: string): string {
  return path.join(ROOT, 'docs', 'operations', `${name}.md`);
}

/** The text of a guide. */
export function guide(name: string): string {
  return readText(guidePath(name));
}

/** One fenced code block: the language after the opening fence (empty when there is none) and the lines between the fences. */
export interface CodeBlock {
  readonly language: string;
  readonly text: string;
}

interface OpenFence {
  readonly fence: string;
  readonly language: string;
  readonly indent: number;
  readonly lines: string[];
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The fence a line opens (three backticks or more, then an optional language), or `undefined` when the line is not a fence. */
function opening(line: string): OpenFence | undefined {
  const text = line.trim();
  const fence = text.slice(0, text.length - text.replace(/^`+/, '').length);
  const language = text.slice(fence.length);
  return fence.length >= 3 && /^[\w-]*$/.test(language)
    ? { fence, language, indent: indentOf(line), lines: [] }
    : undefined;
}

/** Whether a line closes the fence: the same run of backticks and no language. */
function closes(line: string, open: OpenFence): boolean {
  const fence = opening(line);
  return fence?.fence === open.fence && fence.language === '';
}

/** Splits a document into its prose lines and its fenced blocks. A fence indented under a list item is found too. */
function split(markdown: string): { prose: string[]; blocks: CodeBlock[] } {
  const prose: string[] = [];
  const blocks: CodeBlock[] = [];
  let open: OpenFence | undefined;
  for (const line of markdown.split('\n')) {
    if (open === undefined) {
      open = opening(line);
      if (open === undefined) {
        prose.push(line);
      }
    } else if (closes(line, open)) {
      blocks.push({ language: open.language, text: open.lines.join('\n') });
      open = undefined;
    } else {
      open.lines.push(line.slice(Math.min(open.indent, indentOf(line))));
    }
  }
  return { prose, blocks };
}

/** The text of a document without its fenced blocks (a `#` comment in a shell block is not a heading). */
export function proseOf(markdown: string): string {
  return split(markdown).prose.join('\n');
}

/** The fenced blocks of a document, in order; with `language` only the ones that open with it. */
export function codeBlocks(markdown: string, language?: string): CodeBlock[] {
  return split(markdown).blocks.filter((block) => language === undefined || block.language === language);
}

/** A section: the text of its heading and everything up to the next heading of the same or a higher level. */
export interface Section {
  readonly heading: string;
  readonly body: string;
}

/** The depth and the text of a line that is a heading (`#` to `######`, a space, a text), or `undefined`. */
function headingOf(line: string): { depth: number; text: string } | undefined {
  const depth = line.length - line.replace(/^#+/, '').length;
  const text = line.slice(depth);
  return depth >= 1 && depth <= 6 && text.length > 1 && text.startsWith(' ')
    ? { depth, text: text.slice(1) }
    : undefined;
}

/** The headings of the given level (2 for `##`), in order, each with its body (the deeper headings are part of the body). */
export function sectionsOf(markdown: string, level: number): Section[] {
  const sections: { heading: string; lines: string[] }[] = [];
  for (const line of split(markdown).prose) {
    const heading = headingOf(line);
    if (heading !== undefined && heading.depth <= level) {
      sections.push({ heading: heading.depth === level ? heading.text : '', lines: [] });
    } else {
      sections.at(-1)?.lines.push(line);
    }
  }
  return sections
    .filter((section) => section.heading !== '')
    .map((section) => ({ heading: section.heading, body: section.lines.join('\n') }));
}

/** Every heading of the document, whatever its level, as the text after the hashes. */
export function headingsOf(markdown: string): string[] {
  return split(markdown)
    .prose.map((line) => headingOf(line)?.text)
    .filter((heading): heading is string => heading !== undefined);
}

/** The anchor GitHub gives a heading: lower case, backticks and punctuation dropped (letters, digits, `_` and `-` stay), spaces to `-`. */
export function slugOf(heading: string): string {
  return heading
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}_\- ]/gu, '')
    .replaceAll(' ', '-');
}

/** The targets of the inline links `[text](target)` in the prose of a document. */
export function linksOf(markdown: string): string[] {
  return proseOf(markdown)
    .split('](')
    .slice(1)
    .map((rest) => rest.slice(0, Math.max(0, rest.indexOf(')'))))
    .filter((target) => target !== '' && !/\s/.test(target));
}

/** One table of a document: its separator line as written, and the cells of each body row, trimmed. */
export interface Table {
  readonly separator: string;
  readonly rows: readonly (readonly string[])[];
}

/** The cells of one table line: `| a | b |` is `['a', 'b']`. */
function cellsOf(line: string): string[] {
  return line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

/** The tables in the prose of a document, in order. A table is a run of lines that start with `|`: header, separator, rows. */
export function tablesOf(markdown: string): Table[] {
  const tables: string[][] = [];
  let inside = false;
  for (const line of split(markdown).prose.map((candidate) => candidate.trim())) {
    if (line.startsWith('|')) {
      if (!inside) {
        tables.push([]);
      }
      tables.at(-1)?.push(line);
    }
    inside = line.startsWith('|');
  }
  return tables.map((lines) => ({ separator: lines.slice(1, 2).join(''), rows: lines.slice(2).map(cellsOf) }));
}

/** Inline code spans: a run of backticks, then the text up to the next run of the same length (so double backticks can hold single ones). A `[text](target)` inside one is an example, not a link. */
const INLINE_CODE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g;
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

/**
 * The files that the relative links of a document point at, as written but without the `#anchor`. Not counted: links inside
 * fenced blocks and inline code, web addresses and other schemes (`https:`, `mailto:`), and links to an anchor of the same page.
 */
export function relativeLinksOf(markdown: string): string[] {
  return linksOf(proseOf(markdown).replaceAll(INLINE_CODE, ''))
    .filter((target) => !EXTERNAL.test(target))
    .map((target) => target.split('#', 1).join(''))
    .filter((file) => file !== '');
}

/** The Markdown files of the project that the documentation checks cover: `README.md`, then every `.md` file under `docs/` in alphabetical order, as paths from the root of the repository. */
export function projectMarkdown(): string[] {
  const documents = fs.readdirSync(path.join(ROOT, 'docs'), { recursive: true, encoding: 'utf8' });
  return [
    'README.md',
    ...documents
      .filter((name) => name.endsWith('.md'))
      .map((name) => path.join('docs', name))
      .sort((a, b) => a.localeCompare(b)),
  ];
}

/** The source text of a template placeholder, `${inner}`, for tests that look for one in a file (a plain string with one is a lint warning). */
export function placeholder(inner: string): string {
  return ['$', '{', inner, '}'].join('');
}

/** Whether `text` has `needles` in this order, each after the previous one. */
export function inOrder(text: string, needles: readonly string[]): boolean {
  let from = 0;
  for (const needle of needles) {
    const at = text.indexOf(needle, from);
    if (at < 0) {
      return false;
    }
    from = at + needle.length;
  }
  return true;
}

/** The non-test TypeScript files under a directory of the repository, as absolute paths. */
function sourceFiles(directory: string): string[] {
  const base = path.join(ROOT, directory);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a fixed directory of this repository
  return fs
    .readdirSync(base, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !/\.test\.ts$|test-support\.ts$|-fixture\//.test(name))
    .map((name) => path.join(base, name));
}

interface SourceFile {
  readonly file: string;
  readonly text: string;
}

let sources: readonly SourceFile[] | undefined;

/** Every non-test file of the server and the shared code, with its path from the root of the repository. */
function serverFiles(): readonly SourceFile[] {
  sources ??= [...sourceFiles('src/server'), ...sourceFiles('src/shared')].map((file) => ({
    file: path.relative(ROOT, file),
    text: readText(file),
  }));
  return sources;
}

/** Everything the server and the shared code are made of, without tests: what a guide says the server logs, sends or refuses must be in it. */
export function serverSource(): string {
  return serverFiles()
    .map((entry) => entry.text)
    .join('\n');
}

/** The files of the server and the shared code (tests excluded) that contain `needle`, from the root of the repository. */
export function sourceFilesMentioning(needle: string): string[] {
  return serverFiles()
    .filter((entry) => entry.text.includes(needle))
    .map((entry) => entry.file);
}

/** Writes a file into a scratch directory the test made, and returns its path. */
export function writeScratch(directory: string, name: string, text: string, mode?: number): string {
  const file = path.join(directory, name);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a file inside a directory the test made
  fs.writeFileSync(file, text, mode === undefined ? undefined : { mode });
  return file;
}

/**
 * What a process that holds `file` open sees after `change` has replaced it: a running container keeps reading the file it
 * started with, because a bind-mounted file is tied to the file as it was when the container started.
 */
export function readHeldAcross(file: string, change: () => void): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a file inside a directory the test made
  const held = fs.openSync(file, 'r');
  try {
    change();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: the descriptor opened above
    return fs.readFileSync(held, 'utf8');
  } finally {
    fs.closeSync(held);
  }
}
