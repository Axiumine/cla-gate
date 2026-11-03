// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import {
  Badge,
  Button,
  Checkbox,
  Field,
  RadioGroup,
  Select,
  StatusMessage,
  Tabs,
  Textarea,
  TextInput,
} from './index.ts';

// E17-S06 and E17-S10: what holds for the primitives as a set: the page stays free of injected styles (the Content-Security-Policy
// allows none, E17-S03), the sources use no raw HTML and take Radix only from `radix-ui`, and one form of them all is accessible.

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

/** One of every primitive, in one form. */
function Everything() {
  return (
    <form aria-label="Everything">
      <Field label="Name" description="Public" error="Too long" required>
        <TextInput />
      </Field>
      <Field label="Notes">
        <Textarea />
      </Field>
      <Field label="Kind">
        <Select options={OPTIONS} />
      </Field>
      <Field label="Agree" inline>
        <Checkbox name="agree" />
      </Field>
      <Field label="Choice">
        <RadioGroup options={OPTIONS} name="choice" />
      </Field>
      <Tabs label="Sections" items={[{ value: 'a', label: 'Alpha', panel: <p>Panel</p> }]} />
      <Badge status="active" />
      <StatusMessage tone="success">Saved</StatusMessage>
      <Button type="submit" variant="primary" loading>
        Save
      </Button>
    </form>
  );
}

const styleElements = () => document.querySelectorAll('style').length;

test('rendering, focusing, typing in and clicking every primitive adds no <style> element to the page', async () => {
  const before = styleElements();
  const { user } = renderWithProviders(<Everything />);
  await user.tab();
  await user.keyboard('abc');
  await user.click(document.querySelector('[role="checkbox"]') ?? document.body);
  await user.click(document.querySelector('[role="radio"]') ?? document.body);
  await user.click(document.querySelector('[role="tab"]') ?? document.body);
  expect(styleElements()).toBe(before);
  expect(document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0);
});

test('all the primitives in one form pass axe', async () => {
  const { container } = renderWithProviders(<Everything />);
  await expectNoA11yViolations(container);
});

const SOURCES: Record<string, unknown> = import.meta.glob(['./*.{ts,tsx}', '!./*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

const sources = Object.entries(SOURCES).flatMap(([file, text]) =>
  typeof text === 'string' ? [[file, text] as const] : [],
);

test('the sources of the primitives are all there to be checked', () => {
  expect(sources.map(([file]) => file)).toEqual(
    expect.arrayContaining([
      './Button.tsx',
      './Field.tsx',
      './Checkbox.tsx',
      './RadioGroup.tsx',
      './Tabs.tsx',
      './Dialog.tsx',
      './AlertDialog.tsx',
      './DataTable.tsx',
      './CursorPager.tsx',
      './overlay.tsx',
      './index.ts',
    ]),
  );
  expect(sources).toHaveLength(Object.keys(SOURCES).length);
});

test.each(sources)('%s does not use dangerouslySetInnerHTML or innerHTML', (_file, text) => {
  expect(text).not.toMatch(/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML/u);
});

test.each(sources)('%s takes Radix only from the single package radix-ui', (_file, text) => {
  const specifiers = [...text.matchAll(/from\s+'([^']+)'/gu)].map((match) => match[1] ?? '');
  expect(
    specifiers.filter((specifier) => /radix/iu.test(specifier)).every((specifier) => specifier === 'radix-ui'),
  ).toBe(true);
});
