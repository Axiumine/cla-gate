// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { type Env, variable } from '../ci/lib/env.ts';
import { printable } from '../code-caps/types.ts';
import { SHARD_NAMES } from './shards.ts';

// The command line of `yarn mutate` and `yarn mutate:shard` (E20-S04). The shard comes from the first argument or from
// STRYKER_SHARD, never from a guess: a name that is not a shard is an error before anything runs. Everything else on the
// command line (--force, ...) goes to Stryker. MUTATE_BUDGET_MINUTES is the time Stryker may run.

export const STRYKER_SHARD = 'STRYKER_SHARD';
export const BUDGET_VARIABLE = 'MUTATE_BUDGET_MINUTES';
const BUDGET_PATTERN = /^[1-9]\d{0,3}$/;
const MS_PER_MINUTE = 60_000;
export const USAGE = [
  'usage: mutate --all [stryker options]       every shard in turn, the scripts scope last (yarn mutate)',
  '       mutate <shard> [stryker options]     one shard (yarn mutate:shard <shard>)',
  `       ${STRYKER_SHARD}=<shard> mutate [stryker options]`,
  `shards: ${SHARD_NAMES.join(', ')}`,
  `${BUDGET_VARIABLE}=<minutes> stops Stryker after that long; it saves its partial incremental file and the run fails.`,
];

export interface Request {
  readonly shards: readonly string[];
  readonly forward: readonly string[];
  readonly budgetMs: number | undefined;
}

/** What a parsing step gives back: its value, or the text of what is wrong with the command line. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

function good<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function bad(message: string): Parsed<never> {
  return { ok: false, message };
}

/** The budget in milliseconds, or undefined when there is none. */
function budgetOf(env: Env): Parsed<number | undefined> {
  const text = variable(env, BUDGET_VARIABLE);
  if (text === '') {
    return good(undefined);
  }
  return BUDGET_PATTERN.test(text)
    ? good(Number(text) * MS_PER_MINUTE)
    : bad(`${BUDGET_VARIABLE} must be a whole number of minutes from 1 to 9999, not "${printable(text)}"`);
}

/** The shard the caller named, from the first argument or the environment, and what is left for Stryker; an error when there is none, two, or a wrong one. */
function chosenShard(argv: readonly string[], env: Env): Parsed<{ shard: string; forward: readonly string[] }> {
  const [first = '', ...others] = argv;
  const fromEnvironment = variable(env, STRYKER_SHARD);
  const named = first !== '' && !first.startsWith('-');
  if (named && fromEnvironment !== '' && fromEnvironment !== first) {
    return bad(
      `the argument "${printable(first)}" and ${STRYKER_SHARD}="${printable(fromEnvironment)}" name different shards`,
    );
  }
  const shard = named ? first : fromEnvironment;
  if (shard === '') {
    return bad('no shard given');
  }
  return SHARD_NAMES.includes(shard)
    ? good({ shard, forward: named ? others : argv })
    : bad(`"${printable(shard)}" is not a shard`);
}

/** The shards and the options for Stryker, or an error that says what is wrong with the command line. */
export function parse(argv: readonly string[], env: Env): Parsed<Request> {
  const budget = budgetOf(env);
  if (!budget.ok) {
    return budget;
  }
  const budgetMs = budget.value;
  const [first, ...others] = argv;
  if (first !== '--all') {
    const chosen = chosenShard(argv, env);
    return chosen.ok ? good({ shards: [chosen.value.shard], forward: chosen.value.forward, budgetMs }) : chosen;
  }
  const fromEnvironment = variable(env, STRYKER_SHARD);
  return fromEnvironment === ''
    ? good({ shards: SHARD_NAMES, forward: others, budgetMs })
    : bad(`--all runs every shard, so ${STRYKER_SHARD} must be unset (it is "${printable(fromEnvironment)}")`);
}
