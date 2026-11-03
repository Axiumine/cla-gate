// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES } from '../../shared/hostile-names.ts';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { activeContent, expectHostileNamesInert } from '../test-support/hostile.ts';
import { applyUtilitiesOf } from '../test-support/tailwind.ts';
import { UserText } from './UserText.tsx';

// E17-S11: a string a person controls reaches the screen as a text node inside <bdi>, with the characters that change how
// text is drawn written out. The characters are built from code points, never typed (see user-text.test.ts).

const ELLIPSIS = String.fromCodePoint(0x2026);
const RLO = String.fromCodePoint(0x202e);

/** The code points that UserText writes out, as inclusive ranges: written independently of the implementation, as a second opinion. */
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x09],
  [0x0b, 0x1f],
  [0x7f, 0x9f],
  [0xd800, 0xdfff],
  [0x200e, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

/** The hidden characters left in `text`, as their code points. */
const hiddenIn = (text: string): number[] =>
  Array.from(text, (character) => character.codePointAt(0) ?? 0).filter((code) =>
    HIDDEN_RANGES.some(([first, last]) => code >= first && code <= last),
  );

test('the text sits in a bdi element that breaks a long word, as a text node and nothing else', () => {
  const { container } = render(<UserText>octocat</UserText>);
  const bdi = screen.getByText('octocat');
  expect(bdi.tagName).toBe('BDI');
  expect(bdi).toHaveClass('wrap-anywhere');
  expect([...bdi.childNodes].map((node) => node.nodeType)).toEqual([Node.TEXT_NODE]);
  expect(container.children).toHaveLength(1);
});

test('markup in the text is shown as the characters it is made of, and no element comes of it', () => {
  const { container } = render(<UserText>{'<img src=x onerror=alert(1)><b>bold</b>'}</UserText>);
  expect(container.querySelectorAll('img, b, script')).toHaveLength(0);
  expect(container).toHaveTextContent('<img src=x onerror=alert(1)><b>bold</b>');
});

test('markdown is not read: its marks stay as typed', () => {
  const { container } = render(<UserText>{'**bold** [link](http://evil.example) `code` # heading'}</UserText>);
  expect(container.querySelectorAll('strong, em, a, code, h1')).toHaveLength(0);
  expect(container).toHaveTextContent('**bold** [link](http://evil.example) `code` # heading');
});

test('every hostile name of the shared corpus stays inert text', () => {
  expectHostileNamesInert((name) => render(<UserText>{name}</UserText>));
});

test('every hostile name stays inert text when it is cut too, and the whole name is still on the page', () => {
  expectHostileNamesInert((name) => render(<UserText maxLength={5}>{name}</UserText>));
});

test('a control or bidirectional character is written out as a placeholder, and the characters around it are kept', () => {
  const { container } = render(<UserText>{`exe.${RLO}live`}</UserText>);
  expect(container).toHaveTextContent('exe.<U+202E>live');
  expect(hiddenIn(container.textContent)).toEqual([]);
});

test('no entry of the control corpus (line breaks, NUL, a lone surrogate, an override, ten thousand characters) acts', () => {
  expect(HOSTILE_CONTROL_NAMES.length).toBeGreaterThan(0);
  for (const name of HOSTILE_CONTROL_NAMES) {
    const { container, unmount } = render(<UserText>{name}</UserText>);
    expect(hiddenIn(container.textContent), `rendering ${JSON.stringify(name.slice(0, 20))}`).toEqual([]);
    expect(activeContent(container)).toEqual([]);
    unmount();
  }
});

test('the newline stays in the text and the carriage return is written out', () => {
  const { container } = render(<UserText>{'first\r\nsecond'}</UserText>);
  expect(container.textContent).toBe('first<U+000D>\nsecond');
});

test('a text that is not longer than maxLength is shown whole, with no hidden copy', () => {
  const { container } = render(<UserText maxLength={6}>octocat</UserText>);
  expect(container).toHaveTextContent('octocat');
  const shorter = render(<UserText maxLength={7}>octocat</UserText>);
  expect(shorter.container.querySelectorAll('span')).toHaveLength(0);
  expect(shorter.container).toHaveTextContent('octocat');
});

test('a longer text is cut with an ellipsis for the eye, and the whole text sits in a visually hidden node', () => {
  const { container } = render(<UserText maxLength={4}>octocat</UserText>);
  const [visible, whole, ...rest] = container.querySelectorAll('bdi > span');
  expect(rest).toEqual([]);
  expect(visible).toHaveAttribute('aria-hidden', 'true');
  expect(visible).toHaveTextContent(`octo${ELLIPSIS}`);
  expect(visible?.textContent).toBe(`octo${ELLIPSIS}`);
  expect(whole).toHaveClass('sr-only');
  expect(whole).not.toHaveAttribute('aria-hidden');
  expect(whole?.textContent).toBe('octocat');
});

test('assistive technology gets the whole text once: the name of a button that holds a cut text is the text, not the cut', () => {
  render(
    <button type="button">
      <UserText maxLength={4}>octocat</UserText>
    </button>,
  );
  expect(screen.getByRole('button', { name: 'octocat' })).toBeInTheDocument();
});

test('the hidden whole text writes out the controls too, and the ellipsis is not in it', () => {
  const { container } = render(<UserText maxLength={2}>{`a${RLO}bcd`}</UserText>);
  const whole = container.querySelector('.sr-only');
  expect(whole?.textContent).toBe('a<U+202E>bcd');
  expect(container.querySelector('[aria-hidden]')?.textContent).toBe(`a<U+202E>${ELLIPSIS}`);
});

test('a cut that falls inside an emoji sequence keeps the sequence whole', () => {
  const family = [0x1f469, 0x1f469, 0x1f467]
    .map((code) => String.fromCodePoint(code))
    .join(String.fromCodePoint(0x200d));
  const { container } = render(<UserText maxLength={1}>{`${family}abc`}</UserText>);
  expect(container.querySelector('[aria-hidden]')?.textContent).toBe(`${family}${ELLIPSIS}`);
});

test('a 10,000-character word has no break to give the layout, so it is told to wrap anywhere, in a node that is not nowrap', async () => {
  const word = 'x'.repeat(10_000);
  const { container } = render(<UserText>{word}</UserText>);
  const remove = await applyUtilitiesOf(container);
  const bdi = container.querySelector('bdi');
  expect(bdi?.textContent).toHaveLength(10_000);
  const style = bdi ? getComputedStyle(bdi) : null;
  expect(style?.overflowWrap).toBe('anywhere');
  expect(style?.whiteSpace).not.toMatch(/^(?:nowrap|pre)$/u);
  remove();
});

test('cut, the same word shows 20 characters and an ellipsis, and the hidden copy is out of the flow', async () => {
  const { container } = render(<UserText maxLength={20}>{'x'.repeat(10_000)}</UserText>);
  const remove = await applyUtilitiesOf(container);
  const [visible, whole] = container.querySelectorAll('bdi > span');
  expect(visible?.textContent).toHaveLength(21);
  const hidden = whole ? getComputedStyle(whole) : null;
  expect(hidden?.position).toBe('absolute');
  expect(hidden?.width).toBe('1px');
  expect(hidden?.height).toBe('1px');
  expect(hidden?.overflow).toBe('hidden');
  remove();
});

test('it passes axe, cut or not', async () => {
  const plain = render(<UserText>octocat</UserText>);
  await expectNoA11yViolations(plain.container);
  const cut = render(<UserText maxLength={3}>octocat</UserText>);
  await expectNoA11yViolations(cut.container);
});
