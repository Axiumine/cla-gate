// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/** Joins class names, leaving out what is absent: `classNames('a', cond && 'b', props.className)`. */
export function classNames(...parts: readonly (string | false | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== false && part !== '').join(' ');
}
