// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useHeldDialog } from './use-held-dialog.ts';

// E18-S08: an alert dialog that stays open while its request is out, and refuses the close that the confirm button asks for.

const setup = () => renderHook(() => useHeldDialog());

test('the dialog starts closed, opens when it is asked to and closes when the screen says so', () => {
  const { result } = setup();
  expect(result.current.open).toBe(false);
  act(() => {
    result.current.onOpenChange(true, false);
  });
  expect(result.current.open).toBe(true);
  act(() => {
    result.current.close();
  });
  expect(result.current.open).toBe(false);
  act(() => {
    result.current.show();
  });
  expect(result.current.open).toBe(true);
});

test('a close that nobody held, Cancel, closes the dialog when no request is out', () => {
  const { result } = setup();
  act(() => {
    result.current.show();
  });
  act(() => {
    result.current.onOpenChange(false, false);
  });
  expect(result.current.open).toBe(false);
});

test('the close that follows a hold is refused once, and the next one is honoured', () => {
  const { result } = setup();
  act(() => {
    result.current.show();
  });
  act(() => {
    result.current.hold();
    result.current.onOpenChange(false, false);
  });
  expect(result.current.open).toBe(true);
  act(() => {
    result.current.onOpenChange(false, false);
  });
  expect(result.current.open).toBe(false);
});

test('no close is honoured while the request is out', () => {
  const { result } = setup();
  act(() => {
    result.current.show();
  });
  act(() => {
    result.current.onOpenChange(false, true);
  });
  expect(result.current.open).toBe(true);
  act(() => {
    result.current.onOpenChange(false, false);
  });
  expect(result.current.open).toBe(false);
});
