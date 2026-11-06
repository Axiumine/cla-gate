// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { REVOKE_DELAY_MS, saveAsFile, saveBlobAs } from './download-file.ts';
import { stubDownloads } from './test-support.ts';

// E19-S07: a download is a Blob, an object URL, a link clicked once, and the object URL revoked a moment later. E18-S07: a Blob that
// the server made (the signature CSV) goes the same way, as it is.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('it clicks one link whose download name is the name given and whose address is the object URL of the Blob', () => {
  const downloads = stubDownloads();
  saveAsFile('made-up-file', 'made-up value');
  expect(downloads.saved()).toEqual([{ name: 'made-up-file', address: 'blob:made-up-address' }]);
});

test('the Blob is plain text and holds the text as it is, line breaks included', async () => {
  const downloads = stubDownloads();
  saveAsFile('key', 'first\nsecond\n');
  const blob = downloads.create.mock.calls[0]?.[0];
  expect(blob?.type).toBe('text/plain');
  expect(await blob?.text()).toBe('first\nsecond\n');
});

test('the media type of the Blob is the one given, for the data export of E18-S03', () => {
  const downloads = stubDownloads();
  saveAsFile('data.json', '{}', 'application/json');
  expect(downloads.create.mock.calls[0]?.[0].type).toBe('application/json');
});

test('the link is not added to the page, so nothing of the download stays in the document', () => {
  stubDownloads();
  saveAsFile('key', 'value');
  expect(document.querySelector('a[download]')).toBeNull();
});

test('the object URL is revoked after the delay, not before, and only once', () => {
  const downloads = stubDownloads();
  saveAsFile('key', 'value');
  vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
  expect(downloads.revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(downloads.revoke).toHaveBeenCalledExactlyOnceWith('blob:made-up-address');
  vi.advanceTimersByTime(REVOKE_DELAY_MS * 10);
  expect(downloads.revoke).toHaveBeenCalledOnce();
});

test('the delay is long enough for the browser to start the download and short enough that the secret is not kept for the page', () => {
  expect(REVOKE_DELAY_MS).toBeGreaterThanOrEqual(500);
  expect(REVOKE_DELAY_MS).toBeLessThanOrEqual(5000);
});

test('a Blob of the server is saved as it is: the object URL is of that very Blob, under the name given, and the link is clicked once', async () => {
  const downloads = stubDownloads();
  const file = new Blob(['a,b\r\n1,2\r\n'], { type: 'text/csv' });
  saveBlobAs('signatures-11.csv', file);
  expect(downloads.create).toHaveBeenCalledExactlyOnceWith(file);
  expect(downloads.saved()).toEqual([{ name: 'signatures-11.csv', address: 'blob:made-up-address' }]);
  expect(await downloads.create.mock.calls[0]?.[0].text()).toBe('a,b\r\n1,2\r\n');
  expect(document.querySelector('a[download]')).toBeNull();
});

test('the object URL of a Blob of the server is revoked after the delay, and only once', () => {
  const downloads = stubDownloads();
  saveBlobAs('signatures-11.csv', new Blob(['x']));
  vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
  expect(downloads.revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(downloads.revoke).toHaveBeenCalledExactlyOnceWith('blob:made-up-address');
});
