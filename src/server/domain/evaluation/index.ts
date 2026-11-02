// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
// The public surface of the pure PR evaluation engine: what the evaluation job (E07-S04) imports. A new engine module
// joins here and in index.test.ts, which pins the list.
export * from './actor-types.ts';
export * from './actors.ts';
export * from './allowlist.ts';
export * from './classify.ts';
export * from './co-authors.ts';
export * from './coverage.ts';
export * from './coverage-types.ts';
export * from './github-identities.ts';
export { IGNORED_TRAILER_IDENTITIES } from './trailer-identities.ts';
export { MAX_TRAILERS_PER_COMMIT, type ParsedCoAuthors, parseCoAuthors } from './trailers.ts';
export * from './types.ts';
export * from './unlinked.ts';
