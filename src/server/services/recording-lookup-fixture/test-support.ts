// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import { VIEWER } from '../role-fixture/test-support.ts';
import type { CachedRepoAdminLookup } from '../role-lookups.ts';

// The stand-in for the cached permission lookup (E11-S04) that the tests of the repository list (E14-S01) and of the signature search
// (E15-S02) share: it says what it is told to, and records every repository it was asked about and how many were asked at once.

/** A lookup that confirms the repositories named in `administered` (by full name), and keeps what it was asked and how many ran at once. */
export function recordingLookup(administered: ReadonlySet<string> | 'all') {
  const asked: { installation: number; githubInstallationId: number; fullName: string; githubRepoId: number }[] = [];
  const state = { running: 0, mostRunning: 0 };
  const lookup: CachedRepoAdminLookup = async (installation, repository, viewer) => {
    expect(viewer).toBe(VIEWER);
    asked.push({
      installation: installation.id,
      githubInstallationId: installation.github_installation_id,
      fullName: repository.full_name,
      githubRepoId: repository.github_repo_id,
    });
    state.running += 1;
    state.mostRunning = Math.max(state.mostRunning, state.running);
    await Promise.resolve();
    state.running -= 1;
    return administered === 'all' || administered.has(repository.full_name);
  };
  return { lookup, asked, state };
}
