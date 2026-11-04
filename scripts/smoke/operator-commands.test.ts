// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { codeBlocks, guide, inOrder, ROOT } from '../docs/test-support.ts';
import { OPERATOR_COMMANDS } from './operator-commands.ts';

// E19-S12: the backup scenario runs the command lines of docs/operations/backup-restore.md, and that guide says so. Each line
// the scenario runs is a line of a shell block of the guide, character for character, and each is used.

const lines = codeBlocks(guide('backup-restore'), 'sh').flatMap((block) => block.text.split('\n'));
const restoreBlock =
  codeBlocks(guide('backup-restore'), 'sh').find((block) => block.text.includes('docker compose down -v'))?.text ?? '';

test.each(Object.entries(OPERATOR_COMMANDS))(
  'the command %s is a line of a shell block of the guide, word for word',
  (_name, line) => {
    expect(lines).toContain(line);
  },
);

test('the lines that restore are in the guide in the order the scenario runs them: remove, start the database, restore, start the rest', () => {
  const { removeStack, startDatabase, restore, startStack } = OPERATOR_COMMANDS;
  expect(inOrder(restoreBlock, [removeStack, startDatabase, restore, startStack])).toBe(true);
  const dump = lines.indexOf(OPERATOR_COMMANDS.dump);
  expect(dump).toBeGreaterThanOrEqual(0);
  expect(dump).toBeLessThan(lines.indexOf(removeStack));
});

test('the dump and the restore name the same file, in the directory the script runs in', () => {
  expect(OPERATOR_COMMANDS.dump.endsWith('> cla.dump')).toBe(true);
  expect(OPERATOR_COMMANDS.restore.endsWith('< cla.dump')).toBe(true);
});

test('the guide names the scenario that runs these commands, and the scenario runs every one of them', () => {
  expect(guide('backup-restore')).toContain('E19-S12');
  const scenario = readText(path.join(ROOT, 'tests/smoke/backup.test.ts'));
  for (const name of Object.keys(OPERATOR_COMMANDS)) {
    expect(scenario, name).toContain(`COMMANDS.${name}`);
  }
});
