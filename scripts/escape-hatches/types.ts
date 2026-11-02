// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** The escape hatches this gate watches (E20-S16). ESLint, Biome and TypeScript directives have rules of their own. */
export type Hatch = 'any' | 'as assertion' | 'v8 ignore' | 'type-coverage ignore';

/** One escape hatch without its justification: where it is and which element is missing. */
export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly hatch: Hatch;
  /** The element the hatch lacks, written as the author must add it. */
  readonly missing: string;
}

export const REASON = '"-- <reason>"';
export const PRESERVE = '"-- @preserve"';
