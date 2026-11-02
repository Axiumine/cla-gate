// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { isRecheckCommand } from './recheck.ts';

// The exact-line rule of the `/recheck` command (E07-S07): a line that is `/recheck` and nothing else, outside code blocks
// and quotes.

test.each([
  ['the command alone', '/recheck', true],
  ['the command with a final newline', '/recheck\n', true],
  ['the command with a CRLF ending', '/recheck\r\n', true],
  ['the command on one line of several', 'Please look again.\n/recheck\nThanks!', true],
  ['the command on one line of several in a CRLF body', 'Please look again.\r\n/recheck\r\nThanks!\r\n', true],
  ['the command as the last line without a final newline', 'Signed now.\n/recheck', true],
  ['the command as the last line of a CRLF body without a final newline', 'Signed now.\r\n/recheck', true],
  ['the command after blank lines', '\n\n/recheck\n\n', true],
  ['the command twice', '/recheck\n/recheck', true],
  ['the command after a quote that ended', '> sign it\n/recheck', true],
  ['the command after a fenced block that closed', '```\ncode\n```\n/recheck', true],
  ['the command after a tilde block that closed', '~~~\ncode\n~~~\n/recheck', true],
  ['the command after an indented fence, which is no fence', '    ```\n/recheck', true],
  ['the command after a quoted fence opener, which opens nothing', '> ```\n/recheck', true],
  ['the command after an inline code span that looks like a fence', '```code```\n/recheck', true],
  ['the command after a fence closed by a longer fence of the same character', '```\n/recheck\n`````\n/recheck', true],
  ['an empty body', '', false],
  ['only blank lines', '\n\r\n\n', false],
  ['a trailing space', '/recheck ', false],
  ['a leading space', ' /recheck', false],
  ['a tab after the command', '/recheck\t', false],
  ['another case', '/Recheck', false],
  ['upper case', '/RECHECK', false],
  ['more words', '/recheck now', false],
  ['a longer word', '/rechecks', false],
  ['a mention in a sentence', 'could you /recheck please', false],
  ['the command with a second carriage return', '/recheck\r\r\n', false],
  ['the command after a lone carriage return', 'thanks\r/recheck', false],
  ['the command before a line separator', '/recheck ', false],
  ['a fullwidth solidus', '／recheck', false],
  ['a division slash', '∕recheck', false],
  ['a zero-width space inside', '/re​check', false],
  ['a zero-width space before', '​/recheck', false],
  ['a zero-width joiner after', '/recheck‍', false],
  ['a byte order mark before', '﻿/recheck', false],
  ['a no-break space before', ' /recheck', false],
  ['a Cyrillic letter that looks like a Latin one', '/rеcheck', false],
  ['a NUL byte after', '/recheck\0', false],
  ['a quoted reply', '> /recheck', false],
  ['a quoted reply with a space of indentation', ' > /recheck', false],
  ['a quote of the command without a space', '>/recheck', false],
  ['a fenced block of backticks', '```\n/recheck\n```', false],
  ['a fenced block with an info string', '```text\n/recheck\n```', false],
  ['a fenced block of tildes', '~~~\n/recheck\n~~~', false],
  ['a fenced block indented by three spaces', '   ```\n/recheck\n   ```', false],
  ['a fenced block that is never closed', 'run it\n```\n/recheck', false],
  ['a fenced block in a CRLF body', '```\r\n/recheck\r\n```\r\n', false],
  ['a fence that a line indented by four spaces does not close', '```\n    ```\n/recheck', false],
  ['a fence of four backticks that three do not close', '````\n```\n/recheck\n```', false],
  ['a fence of backticks that tildes do not close', '```\n~~~\n/recheck\n~~~', false],
  ['a fence of tildes that backticks do not close', '~~~\n```\n/recheck\n```', false],
  ['a fence that a line with words does not close', '```\n``` not a closer\n/recheck', false],
  ['a quoted line inside a fence, which does not close it', '```\n> done\n/recheck', false],
  ['the command only inside a block, then outside as a mention', '```\n/recheck\n```\nrun /recheck', false],
] as const)('%s', (_name, body, expected) => {
  expect(isRecheckCommand(body)).toBe(expected);
});

test('a fence closed with trailing blanks is closed, and the command after it counts', () => {
  expect(isRecheckCommand('```  \t\n/recheck\n```  \t\n/recheck')).toBe(true);
  expect(isRecheckCommand('```  \t\n/recheck\n```  \t\n')).toBe(false);
});

test('the command is found in a long body, and a body of nothing but fence characters is read to its end', () => {
  const filler = 'a long line of text\n'.repeat(3000);
  expect(isRecheckCommand(`${filler}/recheck`)).toBe(true);
  expect(isRecheckCommand(`${filler}/recheck x`)).toBe(false);
  expect(isRecheckCommand(`${'`'.repeat(200_000)}\n/recheck`)).toBe(false);
  expect(isRecheckCommand(`${'~'.repeat(200_000)} x\n/recheck`)).toBe(false);
});
