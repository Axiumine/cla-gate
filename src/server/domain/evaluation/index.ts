// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
// The public surface of the pure PR evaluation engine: what the evaluation job (E07-S04) imports. A new engine module
// joins here and in index.test.ts, which pins the list.
export * from './actor-types.ts';
export * from './actors.ts';
export { type AllowlistSubject, matchAllowlist } from './allowlist.ts';
export * from './classify.ts';
export * from './co-authors.ts';
export * from './corporate-cover.ts';
export * from './coverage.ts';
export * from './coverage-types.ts';
export * from './evaluate.ts';
export * from './evaluation-types.ts';
export * from './github-identities.ts';
export * from './listing-check.ts';
export * from './listing-plan.ts';
export * from './listing-state.ts';
export * from './repo-walk.ts';
export * from './stored-details.ts';
export { IGNORED_TRAILER_IDENTITIES } from './trailer-identities.ts';
export {
  MAX_TRAILERS_PER_COMMIT,
  type ParsedCoAuthors,
  parseCoAuthors,
  unresolvedCoAuthorNames,
} from './trailers.ts';
export * from './types.ts';
export * from './unlinked.ts';
