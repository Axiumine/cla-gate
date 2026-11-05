// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type GithubId, githubIdSchema } from '../../shared/github-id.ts';

// The arguments of `node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]` (E22-S05). Pure: it reads the
// words after the script name and answers the request or `undefined`; the command prints the usage for `undefined` and nothing
// else, so no argument is ever echoed (an argument is typed by a person and can be anything).

/** What the command is asked to do. */
export interface EraseArguments {
  /** The numeric GitHub id of the person whose personal data is erased. */
  readonly githubId: GithubId;
  /** The numeric GitHub id of the operator who asks, the actor of the audit rows. */
  readonly actor: GithubId;
  /** False for the dry run, which is what the command does without `--execute`. */
  readonly execute: boolean;
}

/** What the command prints when it is called wrongly. */
export const ERASE_USAGE = 'usage: node src/server/erase.ts --github-id <n> --actor-github-id <n> [--execute]';

/** The ids found so far; both are needed before the request exists. */
interface Found {
  readonly githubId?: GithubId;
  readonly actor?: GithubId;
  readonly execute: boolean;
}

/** A positive safe integer written in plain decimal digits: no sign, no leading zero, no exponent, no space, no separator. */
const DECIMAL = /^[1-9]\d{0,15}$/;

/** The GitHub id the word spells, or `undefined` for anything that is not a positive safe integer. */
function idOf(word: string | undefined): GithubId | undefined {
  if (word === undefined || !DECIMAL.test(word)) {
    return undefined;
  }
  const parsed = githubIdSchema.safeParse(Number(word));
  return parsed.success ? parsed.data : undefined;
}

/** What each flag that takes an id does with it: it sets its field, once. */
const SETTERS: ReadonlyMap<string, (found: Found, id: GithubId) => Found | undefined> = new Map<
  string,
  (found: Found, id: GithubId) => Found | undefined
>([
  ['--github-id', (found, id) => (found.githubId === undefined ? { ...found, githubId: id } : undefined)],
  ['--actor-github-id', (found, id) => (found.actor === undefined ? { ...found, actor: id } : undefined)],
]);

/** The state after `--execute`, or `undefined` when it was given before. */
function execute(found: Found): Found | undefined {
  return found.execute ? undefined : { ...found, execute: true };
}

/** The state after the flag `word` with the `value` that follows it, or `undefined` for a word that is not a flag, or a value that is not an id. */
function withId(found: Found, word: string, value: string | undefined): Found | undefined {
  const set = SETTERS.get(word);
  const id = idOf(value);
  return set === undefined || id === undefined ? undefined : set(found, id);
}

/**
 * Reads the arguments after the script name: `--github-id <n>` and `--actor-github-id <n>`, each exactly once, and `--execute`
 * at most once, in any order. Both ids are positive safe integers in plain decimal digits. Anything else (an unknown word, a
 * missing or repeated flag, a value that is not such an integer, the `--flag=value` spelling) is `undefined`.
 */
export function parseEraseArguments(argv: readonly string[]): EraseArguments | undefined {
  const words = argv.values();
  let found: Found = { execute: false };
  for (const word of words) {
    // A flag that takes an id consumes the word after it, which is read from the same iterator.
    const next = word === '--execute' ? execute(found) : withId(found, word, words.next().value);
    if (next === undefined) {
      return undefined;
    }
    found = next;
  }
  return found.githubId === undefined || found.actor === undefined
    ? undefined
    : { githubId: found.githubId, actor: found.actor, execute: found.execute };
}
