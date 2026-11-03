// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { AlertDialog } from './AlertDialog.tsx';
import { Button } from './Button.tsx';
import { Dialog, DialogClose } from './Dialog.tsx';
import { SCROLL_LOCK_CLASS } from './overlay.tsx';
import { UserText } from './UserText.tsx';

// E17-S10: AlertDialog, on Radix's: a question that only its two buttons answer, with focus on the safe one first.

const revoke = <Button variant="danger">Revoke signature</Button>;
const alertDialog = () => screen.getByRole('alertdialog');
const queryAlert = () => screen.queryByRole('alertdialog');
const styleElements = () => document.querySelectorAll('style').length;

function Question({ onConfirm = vi.fn() }: { readonly onConfirm?: () => void }) {
  return (
    <AlertDialog
      title="Revoke this signature?"
      description="The signer will have to sign again."
      confirmLabel="Revoke"
      onConfirm={onConfirm}
      trigger={revoke}
      destructive
    >
      <p>It cannot be undone.</p>
    </AlertDialog>
  );
}

async function opened(onConfirm = vi.fn()) {
  const view = renderWithProviders(<Question onConfirm={onConfirm} />);
  await view.user.click(screen.getByRole('button', { name: 'Revoke signature' }));
  return view;
}

test('it is an alertdialog named by its question and described by what is at stake, with the extra body in it', async () => {
  const { user } = renderWithProviders(<Question />);
  expect(queryAlert()).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Revoke signature' }));
  expect(screen.getByRole('alertdialog', { name: 'Revoke this signature?' })).toHaveAccessibleDescription(
    'The signer will have to sign again.',
  );
  expect(within(alertDialog()).getByText('It cannot be undone.')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('focus starts on Cancel, the safe answer, and Tab stays inside the dialog', async () => {
  const { user } = await opened();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Revoke' })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(screen.getByRole('button', { name: 'Revoke' })).toHaveFocus();
  expect(screen.queryByRole('button', { name: 'Revoke signature' })).not.toBeInTheDocument();
});

test('Escape does not close it: only an explicit choice does', async () => {
  const onConfirm = vi.fn();
  const { user } = await opened(onConfirm);
  await user.keyboard('{Escape}');
  expect(alertDialog()).toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
});

test('a click on the backdrop does not close it either', async () => {
  await opened();
  // jsdom has no stylesheet, so the backdrop's `pointer-events: auto` is not there: 0 is PointerEventsCheck.Never.
  await userEvent.setup({ pointerEventsCheck: 0 }).click(alertDialog().parentElement ?? document.body);
  expect(alertDialog()).toBeInTheDocument();
});

test('Cancel with Enter or Space closes it without confirming, and focus goes back to the trigger', async () => {
  const onConfirm = vi.fn();
  const { user } = await opened(onConfirm);
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(queryAlert()).not.toBeInTheDocument();
  });
  const trigger = screen.getByRole('button', { name: 'Revoke signature' });
  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });
  await user.keyboard(' ');
  expect(alertDialog()).toBeInTheDocument();
  await user.keyboard(' ');
  await waitFor(() => {
    expect(queryAlert()).not.toBeInTheDocument();
  });
  expect(onConfirm).not.toHaveBeenCalled();
});

test('the confirm button runs the action once and closes the dialog, with the mouse, Enter or Space', async () => {
  const onConfirm = vi.fn();
  const { user } = await opened(onConfirm);
  await user.click(screen.getByRole('button', { name: 'Revoke' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(queryAlert()).not.toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: 'Revoke signature' }));
  await user.tab();
  await user.keyboard('{Enter}');
  expect(onConfirm).toHaveBeenCalledTimes(2);
  await waitFor(() => {
    expect(queryAlert()).not.toBeInTheDocument();
  });
  await user.click(screen.getByRole('button', { name: 'Revoke signature' }));
  await user.tab();
  await user.keyboard(' ');
  expect(onConfirm).toHaveBeenCalledTimes(3);
});

test('a destructive question has the danger button and the other the primary one; the labels can be given', async () => {
  const { user, rerender } = renderWithProviders(
    <AlertDialog open title="Q" description="D" confirmLabel="Go" cancelLabel="Never mind" onConfirm={vi.fn()} />,
  );
  expect(screen.getByRole('button', { name: 'Go' }).className).toContain('bg-accent');
  expect(screen.getByRole('button', { name: 'Never mind' })).toHaveFocus();
  rerender(<AlertDialog open title="Q" description="D" confirmLabel="Go" onConfirm={vi.fn()} destructive />);
  expect(screen.getByRole('button', { name: 'Go' }).className).toContain('bg-danger');
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(alertDialog()).toBeInTheDocument();
});

test('while the action is under way the confirm button is busy and ignores clicks, and a controlled dialog stays open', async () => {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  const { user } = renderWithProviders(
    <AlertDialog
      open
      confirming
      title="Q"
      description="D"
      confirmLabel="Go"
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
    />,
  );
  const confirm = screen.getByRole('button', { name: 'Go' });
  expect(confirm).toHaveAttribute('aria-busy', 'true');
  await user.click(confirm);
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(alertDialog()).toBeInTheDocument();
});

test('a dialog with no trigger of its own gives focus back to the element that opened it', async () => {
  const { user, rerender } = renderWithProviders(
    <>
      <Button>Row action</Button>
      <AlertDialog open={false} title="Q" description="D" confirmLabel="Go" onConfirm={vi.fn()} />
    </>,
  );
  const rowAction = screen.getByRole('button', { name: 'Row action' });
  await user.click(rowAction);
  rerender(
    <>
      <Button>Row action</Button>
      <AlertDialog open title="Q" description="D" confirmLabel="Go" onConfirm={vi.fn()} />
    </>,
  );
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  rerender(
    <>
      <Button>Row action</Button>
      <AlertDialog open={false} title="Q" description="D" confirmLabel="Go" onConfirm={vi.fn()} />
    </>,
  );
  await waitFor(() => {
    expect(rowAction).toHaveFocus();
  });
});

test('opening it from inside a dialog stacks: Escape leaves both open, and the page unlocks only when the last one is gone', async () => {
  const { user } = renderWithProviders(
    <Dialog defaultOpen title="Outer" description="The first dialog.">
      <AlertDialog
        title="Sure?"
        description="This closes everything."
        confirmLabel="Yes"
        onConfirm={vi.fn()}
        trigger={<Button>Discard</Button>}
      />
      <DialogClose>
        <Button>Done</Button>
      </DialogClose>
    </Dialog>,
  );
  await user.click(screen.getByRole('button', { name: 'Discard' }));
  await user.keyboard('{Escape}');
  expect(alertDialog()).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Outer', hidden: true })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => {
    expect(queryAlert()).not.toBeInTheDocument();
  });
  expect(document.documentElement).toHaveClass(SCROLL_LOCK_CLASS);
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => {
    expect(document.documentElement).not.toHaveClass(SCROLL_LOCK_CLASS);
  });
});

test('opening and closing it adds no <style> element to the page', async () => {
  const before = styleElements();
  const { user } = await opened();
  expect(document.documentElement).toHaveClass(SCROLL_LOCK_CLASS);
  expect(styleElements()).toBe(before);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => {
    expect(document.documentElement).not.toHaveClass(SCROLL_LOCK_CLASS);
  });
  expect(styleElements()).toBe(before);
});

test('the open alert dialog passes axe', async () => {
  await opened();
  await expectNoA11yViolations(alertDialog());
});

test('a hostile name in the question, the description and the body stays text', () => {
  expectHostileNamesInert((name) => {
    const view = renderWithProviders(
      <AlertDialog
        open
        title={<UserText>{name}</UserText>}
        description={<UserText>{name}</UserText>}
        confirmLabel="Go"
        onConfirm={vi.fn()}
      >
        <UserText>{name}</UserText>
      </AlertDialog>,
    );
    return { container: document.body, unmount: view.unmount };
  });
});
