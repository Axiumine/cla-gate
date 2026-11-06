// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, render as renderPlain, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18nProvider.tsx';
import { messages } from '../../i18n/index.ts';
import { expectNoA11yViolations } from '../../test-support/a11y.ts';
import {
  FakeRenderWorker,
  installFakeRenderWorker,
  setWorkerBehaviour,
} from '../../test-support/fake-render-worker.ts';
import { MarkdownView } from './MarkdownView.tsx';
import { RENDER_BUDGET_MS, SYNC_RENDER_MAX_CHARS } from './render-limits.ts';

// E18: a CLA text is chosen by a tenant admin and the parser does not take linear time for every text, so a text longer than
// SYNC_RENDER_MAX_CHARS is rendered by a worker that the page ends after RENDER_BUDGET_MS, and the text is shown as it was written
// when the worker does not deliver. A short text never starts a worker.

/** A text of exactly `length` characters: a heading, then filler words. */
function textOf(length: number, head = '# Terms\n\n'): string {
  return head + 'word '.repeat(Math.ceil(length / 5)).slice(0, length - head.length);
}

const LONG = textOf(SYNC_RENDER_MAX_CHARS + 1);
/** Renders `ui` where the page has its words, and keeps them there when it is rendered again. */
function render(ui: ReactElement) {
  const view = renderPlain(<I18nProvider>{ui}</I18nProvider>);
  return {
    ...view,
    rerender: (next: ReactElement) => {
      view.rerender(<I18nProvider>{next}</I18nProvider>);
    },
  };
}

const plainBlock = (container: HTMLElement) => container.querySelector('pre');

beforeEach(() => {
  installFakeRenderWorker();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('the limits are what the page promises: a few thousand characters on the page, a few seconds in a worker', () => {
  expect(SYNC_RENDER_MAX_CHARS).toBe(4096);
  expect(RENDER_BUDGET_MS).toBe(4000);
  expect(LONG).toHaveLength(SYNC_RENDER_MAX_CHARS + 1);
});

test('a text of exactly the limit is drawn at once by the page and starts no worker', () => {
  const { container } = render(<MarkdownView source={textOf(SYNC_RENDER_MAX_CHARS)} />);
  expect(screen.getByRole('heading', { name: 'Terms' }).tagName).toBe('H2');
  expect(FakeRenderWorker.instances).toEqual([]);
  expect(plainBlock(container)).toBeNull();
});

test('a text one character over the limit says that it is being prepared, then it is drawn from the tree the worker made', async () => {
  const { container } = render(<MarkdownView source={LONG} />);
  expect(screen.getByRole('status')).toHaveTextContent(messages['markdown.pending']);
  expect(screen.queryByRole('heading', { name: 'Terms' })).toBeNull();
  expect(await screen.findByRole('heading', { name: 'Terms' })).toBeInTheDocument();
  expect(screen.queryByText(messages['markdown.pending'])).toBeNull();
  expect(plainBlock(container)).toBeNull();
  expect(FakeRenderWorker.instances).toHaveLength(1);
  expect(FakeRenderWorker.instances[0]?.posted).toEqual([{ source: LONG }]);
});

test('the worker is ended once it has answered, so no worker is left running', async () => {
  render(<MarkdownView source={LONG} />);
  await screen.findByRole('heading', { name: 'Terms' });
  expect(FakeRenderWorker.instances.map((worker) => worker.terminated)).toEqual([true]);
});

test('the headings of a long text are shown below the page heading, as those of a short one', async () => {
  render(<MarkdownView source={LONG} headingLevel={3} />);
  expect((await screen.findByRole('heading', { name: 'Terms' })).tagName).toBe('H3');
});

test('a worker that does not answer within the budget is ended, and the text is shown exactly as it was written', () => {
  installFakeRenderWorker('silent');
  vi.useFakeTimers();
  const { container } = render(<MarkdownView source={LONG} />);
  act(() => {
    vi.advanceTimersByTime(RENDER_BUDGET_MS - 1);
  });
  expect(screen.getByRole('status')).toHaveTextContent(messages['markdown.pending']);
  expect(FakeRenderWorker.instances[0]?.terminated).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(FakeRenderWorker.instances[0]?.terminated).toBe(true);
  expect(plainBlock(container)?.textContent).toBe(LONG);
  expect(screen.getByRole('status')).toHaveTextContent(messages['markdown.plain']);
  expect(screen.queryByRole('heading', { name: 'Terms' })).toBeNull();
});

test('an answer that arrives after the page gave up is not shown: the text stays as it was written', () => {
  installFakeRenderWorker('silent');
  vi.useFakeTimers();
  const { container } = render(<MarkdownView source={LONG} />);
  act(() => {
    vi.advanceTimersByTime(RENDER_BUDGET_MS);
  });
  act(() => {
    FakeRenderWorker.instances[0]?.dispatchEvent(
      new MessageEvent('message', { data: { tree: { type: 'root', children: [] } } }),
    );
  });
  expect(plainBlock(container)?.textContent).toBe(LONG);
  expect(screen.getByRole('status')).toHaveTextContent(messages['markdown.plain']);
});

test('the page does not draw a long text itself while the worker is busy: a text that freezes the parser is not handed to it', () => {
  installFakeRenderWorker('silent');
  const pathological = `${'*_'.repeat(100_000)}x\n`;
  const { container } = render(<MarkdownView source={pathological} />);
  expect(screen.getByRole('status')).toHaveTextContent(messages['markdown.pending']);
  expect(container.querySelector('em, strong, p')).toBeNull();
});

test('a worker that fails is the text as it was written, at once', async () => {
  installFakeRenderWorker('error');
  const { container } = render(<MarkdownView source={LONG} />);
  await waitFor(() => {
    expect(plainBlock(container)?.textContent).toBe(LONG);
  });
  expect(FakeRenderWorker.instances[0]?.terminated).toBe(true);
});

test('an answer that is not a tree is the text as it was written', async () => {
  installFakeRenderWorker('garbage');
  const { container } = render(<MarkdownView source={LONG} />);
  await waitFor(() => {
    expect(plainBlock(container)?.textContent).toBe(LONG);
  });
});

test('a browser with no workers shows the text as it was written', async () => {
  vi.stubGlobal('Worker', undefined);
  const { container } = render(<MarkdownView source={LONG} />);
  await waitFor(() => {
    expect(plainBlock(container)?.textContent).toBe(LONG);
  });
});

test('a new long text starts a new worker and ends the old one, and the old text is never shown for the new one', async () => {
  installFakeRenderWorker('silent');
  const { rerender } = render(<MarkdownView source={textOf(SYNC_RENDER_MAX_CHARS + 1, '# First\n\n')} />);
  const [first] = FakeRenderWorker.instances;
  expect(first?.terminated).toBe(false);
  setWorkerBehaviour('render');
  rerender(<MarkdownView source={textOf(SYNC_RENDER_MAX_CHARS + 2, '# Second\n\n')} />);
  expect(first?.terminated).toBe(true);
  expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'First' })).toBeNull();
  expect(FakeRenderWorker.instances).toHaveLength(2);
});

test('a text that was pending is pending again when the text changes, and not the answer to the old one', async () => {
  const { rerender } = render(<MarkdownView source={textOf(SYNC_RENDER_MAX_CHARS + 1, '# First\n\n')} />);
  await screen.findByRole('heading', { name: 'First' });
  rerender(<MarkdownView source={textOf(SYNC_RENDER_MAX_CHARS + 2, '# Second\n\n')} />);
  expect(screen.queryByRole('heading', { name: 'First' })).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent(messages['markdown.pending']);
  expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument();
  expect(FakeRenderWorker.instances).toHaveLength(2);
});

test('leaving the page ends the worker', () => {
  installFakeRenderWorker('silent');
  const { unmount } = render(<MarkdownView source={LONG} />);
  expect(FakeRenderWorker.instances[0]?.terminated).toBe(false);
  unmount();
  expect(FakeRenderWorker.instances[0]?.terminated).toBe(true);
});

test('a long text that grows past the limit while being edited starts the worker then, and one that shrinks is drawn by the page', async () => {
  const { rerender } = render(<MarkdownView source={textOf(SYNC_RENDER_MAX_CHARS)} />);
  expect(FakeRenderWorker.instances).toHaveLength(0);
  rerender(<MarkdownView source={LONG} />);
  await screen.findByRole('heading', { name: 'Terms' });
  expect(FakeRenderWorker.instances).toHaveLength(1);
  rerender(<MarkdownView source={textOf(SYNC_RENDER_MAX_CHARS)} />);
  expect(screen.getByRole('heading', { name: 'Terms' })).toBeInTheDocument();
  expect(FakeRenderWorker.instances).toHaveLength(1);
});

test('hostile markup in a long text reaches the page as text: no script, image or active link, drawn from the tree or as written', async () => {
  const hostile = `<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n${textOf(SYNC_RENDER_MAX_CHARS + 1)}`;
  const { container } = render(<MarkdownView source={hostile} />);
  await screen.findByRole('heading', { name: 'Terms' });
  expect(container.querySelectorAll('script, img, [onerror], a')).toHaveLength(0);
  expect(container.textContent).toContain('<script>alert(1)</script>');
});

test('the same hostile text shown as written is one text node in a block of code, with nothing active', async () => {
  installFakeRenderWorker('error');
  const hostile = `<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n${textOf(SYNC_RENDER_MAX_CHARS + 1)}`;
  const { container } = render(<MarkdownView source={hostile} />);
  await waitFor(() => {
    expect(plainBlock(container)?.textContent).toBe(hostile);
  });
  expect(container.querySelectorAll('script, img, [onerror]')).toHaveLength(0);
  expect(plainBlock(container)?.children).toHaveLength(0);
});

test('a long text, drawn and shown as written, passes axe', async () => {
  const drawn = render(<MarkdownView source={LONG} />);
  await screen.findByRole('heading', { name: 'Terms' });
  await expectNoA11yViolations(drawn.container);
  drawn.unmount();
  installFakeRenderWorker('error');
  const plain = render(<MarkdownView source={LONG} />);
  await waitFor(() => {
    expect(plainBlock(plain.container)).not.toBeNull();
  });
  await expectNoA11yViolations(plain.container);
});
