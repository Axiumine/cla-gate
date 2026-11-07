// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, test } from 'vitest';
import { CHECK_RUN_NAME } from '../shared/check.ts';
import { LEGACY_STATUS_NOTICE } from '../shared/notices.ts';
import { RECHECK_WINDOW_SECONDS } from './domain/recheck.ts';
import { renderCheckOutput } from './domain/reporting/check-output.ts';
import type { CheckView } from './domain/reporting/check-view.ts';

// E09-S09: `docs/legacy-status-coexistence.md` is what an operator reads before enabling a repository that another CLA tool
// covers. Its facts are tied to the code and to `docs/github-app.md` here, so that a change to either one fails a test instead
// of leaving the page wrong: the conclusions come from the renderer, the rate limit from the `/recheck` rule, the permission
// table from the file that owns it.

const DOC_PATH = 'docs/legacy-status-coexistence.md';
const DOC = readFileSync(DOC_PATH, 'utf8');
const APP_DOC = readFileSync('docs/github-app.md', 'utf8');

/** The sentence of `docs/github-app.md` that the page repeats and claims nothing beyond. */
const SAME_NAME_SENTENCE = 'a check and a commit status with the same name must both pass';

/** One view of every kind the renderer knows, in the shape of the `CheckView` union. */
const VIEWS: readonly CheckView[] = [
  {
    kind: 'success',
    headSha: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    covered: { signature: 1, allowlist: 0, corporate: 0, override: 0 },
  },
  { kind: 'failure', headSha: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b', unsigned: 1, unlinked: 0, summary: [] },
  { kind: 'in_progress', headSha: '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b' },
  { kind: 'cancelled' },
  { kind: 'enforcement_disabled' },
  { kind: 'evaluation_failed' },
];

/** What GitHub counts as passing for a required check (`docs/github-app.md`, Gotchas). */
const GITHUB_PASSING = ['success', 'skipped', 'neutral'];

/** The text of the section of `DOC` that starts at the heading `## {heading}` and runs to the next `## ` heading. */
function section(heading: string): string {
  const start = DOC.indexOf(`\n## ${heading}\n`);
  expect(start, `${DOC_PATH} has no "## ${heading}" section`).toBeGreaterThan(-1);
  const rest = DOC.slice(start + 1);
  const end = rest.indexOf('\n## ', 1);
  return end === -1 ? rest : rest.slice(0, end);
}

/** The data rows of the conclusions table as `[conclusion, passes, when]`, the header and the separator left out. */
function conclusionRows(): (readonly [conclusion: string, passes: string, when: string])[] {
  return section('Branch protection')
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const [conclusion = '', passes = '', when = ''] = line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      return [conclusion.replaceAll('`', ''), passes, when] as const;
    });
}

/** The conclusions the renderer writes for the views a report can be, without repeats, in a fixed order. */
function writtenConclusions(): string[] {
  const conclusions = VIEWS.map((view) => renderCheckOutput(view).conclusion);
  return [...new Set(conclusions.filter((conclusion) => conclusion !== undefined))].toSorted((a, b) =>
    a.localeCompare(b),
  );
}

test('the notice is one sentence that ends with the path of a document that exists', () => {
  const path = /\((docs\/[a-z-]+\.md)\)\.$/u.exec(LEGACY_STATUS_NOTICE)?.[1];
  expect(path, 'the notice must end with (docs/<name>.md).').toBe(DOC_PATH);
  expect(existsSync(DOC_PATH)).toBe(true);
  expect(LEGACY_STATUS_NOTICE).not.toMatch(/\n/u);
  expect(LEGACY_STATUS_NOTICE.match(/[.!?](?=\s|$)/gu)).toHaveLength(1);
});

test('the notice tells the operator to disable the other tool first, and does not spell the check name', () => {
  expect(LEGACY_STATUS_NOTICE).toMatch(/^Disable any other CLA tool for this repository before you enable it here/u);
  expect(LEGACY_STATUS_NOTICE).not.toContain(CHECK_RUN_NAME);
});

test('the rule section names the check, says it is never renamed and puts the disabling before the enabling', () => {
  const rule = section('The rule');
  expect(rule).toContain(`\`${CHECK_RUN_NAME}\``);
  expect(rule).toContain('never renamed');
  expect(rule).toContain('must both pass');
  expect(rule).toContain('disabled for a repository before the repository is enabled here');
});

test('the steps come in order: remove the legacy tool, confirm no status of that name, enable the repository', () => {
  const steps = section('Steps');
  const remove = steps.indexOf('Remove the legacy tool');
  const confirm = steps.indexOf('Confirm that its statuses hold no');
  const enable = steps.indexOf('Enable the repository here');
  expect(remove).toBeGreaterThan(-1);
  expect(confirm).toBeGreaterThan(remove);
  expect(enable).toBeGreaterThan(confirm);
  expect(steps).toContain('uninstall the legacy app for that repository');
  expect(steps).toContain('webhook');
});

test('the confirmation step gives the gh api command for the statuses of a commit and names the context to look for', () => {
  const steps = section('Steps');
  expect(steps).toContain('```sh\n   gh api repos/{owner}/{repo}/commits/{sha}/statuses\n   ```');
  expect(steps).toContain(`no entry whose \`context\` is \`${CHECK_RUN_NAME}\``);
  expect(steps).toContain('made after step 1');
});

test('the branch protection section repeats the facts of github-app.md, which still holds them', () => {
  const protection = section('Branch protection');
  for (const fact of ['ruleset `integration_id`', 'within the last 7 days', 'open a test pull request']) {
    expect(protection).toContain(fact);
  }
  expect(APP_DOC).toContain('ruleset `integration_id`');
  expect(APP_DOC).toContain('reported within 7 days');
  expect(APP_DOC).toContain('passing conclusions are `success`, `skipped`, `neutral`');
  expect(protection).toContain('counts `success`, `skipped` and `neutral` as passing');
  expect(protection).toContain('does not count `cancelled`, `failure`, `timed_out` or `action_required`');
});

test('the table lists exactly the conclusions the renderer writes, and marks the passing ones as GitHub does', () => {
  const rows = conclusionRows();
  expect(rows.map(([conclusion]) => conclusion).toSorted((a, b) => a.localeCompare(b))).toEqual(writtenConclusions());
  for (const [conclusion, passes] of rows) {
    expect(passes, `passing column of ${conclusion}`).toBe(GITHUB_PASSING.includes(conclusion) ? 'yes' : 'no');
  }
});

test('the conclusions this App never writes are named as such, and none of them is a row of the table', () => {
  const never = ['skipped', 'timed_out', 'action_required', 'stale'];
  expect(section('Branch protection')).toContain(
    '`skipped`, `timed_out`, `action_required` and `stale` are never written',
  );
  expect(writtenConclusions().filter((conclusion) => never.includes(conclusion))).toEqual([]);
});

test('neutral is the disabled repository and cancelled the closed pull request, and no other view writes them', () => {
  const byView = Object.fromEntries(VIEWS.map((view) => [view.kind, renderCheckOutput(view).conclusion]));
  expect(byView).toEqual({
    success: 'success',
    failure: 'failure',
    in_progress: undefined,
    cancelled: 'cancelled',
    enforcement_disabled: 'neutral',
    evaluation_failed: 'failure',
  });
  const rows = new Map(conclusionRows().map(([conclusion, , when]) => [conclusion, when]));
  expect(rows.get('neutral')).toContain('disabled repository');
  expect(rows.get('cancelled')).toContain('closed pull request');
});

test('the page says the App does not detect a legacy status, because that permission is not requested, and it is not', () => {
  const limits = section('What the App does not do');
  expect(limits).toContain('does not detect a legacy status at runtime');
  expect(limits).toContain('on purpose');
  expect(limits).toContain('`Commit statuses: read` permission');
  expect(limits).toContain('no permission without a recorded reason');
  const permissionRows = APP_DOC.split('\n').filter((line) =>
    /^\| (?:Repository|Organization|Account|Later):/u.test(line),
  );
  expect(permissionRows.length).toBeGreaterThan(0);
  expect(permissionRows.filter((row) => /status/iu.test(row))).toEqual([]);
  expect(APP_DOC).toContain('Do not add permissions without a reason recorded in that table');
});

test('the only claim about two entries of one name is the sentence of github-app.md', () => {
  const normalised = (text: string): string => text.replaceAll(/\s+/gu, ' ').toLowerCase();
  expect(normalised(DOC)).toContain(SAME_NAME_SENTENCE);
  expect(normalised(APP_DOC)).toContain(SAME_NAME_SENTENCE);
  expect(section('What the App does not do')).toContain(
    'says nothing about how a ruleset treats two entries of the same name',
  );
  // No sentence of the page says what a ruleset does with the two entries: merges them, ignores one, prefers one.
  expect(DOC).not.toMatch(/ruleset[^.\n]*\b(?:ignores?|merges?|prefers?|treats? as one|deduplicates?)\b/iu);
});

test('the comment section says overwritten on every evaluation, no comment without a failure, and one /recheck a minute', () => {
  const comment = section('The pull request comment');
  expect(comment).toContain('overwritten on every evaluation');
  expect(comment).toContain('lost at the next one');
  expect(comment).toContain('never failed gets no comment');
  expect(comment).toContain('existing comment is edited to say that all contributors have signed');
  expect(comment).toContain('`/recheck`');
  expect(comment).toContain('once a minute for each pull request');
  expect(RECHECK_WINDOW_SECONDS).toBe(60);
});

test('every table of the page uses the separator |---| per column, and the page holds no @ at all, so no email address', () => {
  const separators = DOC.split('\n').filter((line) => line.startsWith('|') && /^[\s|:-]+$/u.test(line));
  expect(separators).toEqual(['|---|---|---|']);
  expect(DOC).not.toContain('@');
});

test('the Check name row of the Settings table in docs/github-app.md links to this page', () => {
  const row = APP_DOC.split('\n').find((line) => line.startsWith('| Check name |'));
  expect(row, 'docs/github-app.md has no Check name row').toBeDefined();
  const page = basename(DOC_PATH);
  expect(row).toContain(`[${page}](${page})`);
});
