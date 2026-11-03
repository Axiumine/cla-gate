// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, useState } from 'react';
import { expect, test, vi } from 'vitest';
import { expectNoA11yViolations } from '../test-support/a11y.ts';
import { expectHostileNamesInert } from '../test-support/hostile.ts';
import { renderWithProviders } from '../test-support/render.tsx';
import { Button } from './Button.tsx';
import { Dialog, DialogClose } from './Dialog.tsx';
import { SCROLL_LOCK_CLASS } from './overlay.tsx';
import { TextInput } from './TextInput.tsx';
import { UserText } from './UserText.tsx';

// E17-S10: Dialog, on Radix's: opens from its trigger, traps focus, closes on Escape, the close button and a click
// outside, and gives focus back.

const opener = <Button>Open settings</Button>;
const dialog = () => screen.getByRole('dialog');
const queryDialog = () => screen.queryByRole('dialog');
const styleElements = () => document.querySelectorAll('style').length;

function Settings({ trigger = opener }: { readonly trigger?: ReactElement | undefined }) {
  return (
    <>
      <button type="button">Elsewhere</button>
      <Dialog
        title="Settings"
        description="Change how the page looks."
        trigger={trigger}
        footer={
          <>
            <DialogClose>
              <Button>Cancel</Button>
            </DialogClose>
            <Button variant="primary">Save</Button>
          </>
        }
      >
        <TextInput aria-label="Display name" />
      </Dialog>
    </>
  );
}

test('the dialog is not in the page until the trigger opens it, and then it has its title as its name and its description', async () => {
  const { user } = renderWithProviders(<Settings />);
  expect(queryDialog()).not.toBeInTheDocument();
  const trigger = screen.getByRole('button', { name: 'Open settings' });
  expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await user.click(trigger);
  expect(screen.getByRole('dialog', { name: 'Settings' })).toHaveAccessibleDescription('Change how the page looks.');
  expect(within(dialog()).getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('Enter and Space on the focused trigger open it', async () => {
  const { user } = renderWithProviders(<Settings />);
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Open settings' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(dialog()).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
  await user.keyboard(' ');
  expect(dialog()).toBeInTheDocument();
});

test('focus moves into the dialog, and the rest of the page is out of the accessibility tree while it is open', async () => {
  const { user } = renderWithProviders(<Settings />);
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  expect(dialog().contains(document.activeElement)).toBe(true);
  expect(screen.queryByRole('button', { name: 'Elsewhere' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open settings' })).not.toBeInTheDocument();
});

test('Tab and Shift+Tab stay inside the dialog and wrap from the last control to the first and back', async () => {
  const { user } = renderWithProviders(<Settings />);
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  const name = (accessibleName: string) => screen.getByRole('button', { name: accessibleName });
  expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveFocus();
  for (const next of ['Cancel', 'Save', 'Close']) {
    await user.tab();
    expect(name(next)).toHaveFocus();
  }
  await user.tab();
  expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveFocus();
  await user.tab({ shift: true });
  expect(name('Close')).toHaveFocus();
  for (let step = 0; step < 6; step += 1) {
    await user.tab();
    expect(dialog().contains(document.activeElement)).toBe(true);
  }
});

test('Escape closes the dialog and focus goes back to the trigger', async () => {
  const { user } = renderWithProviders(<Settings />);
  const trigger = screen.getByRole('button', { name: 'Open settings' });
  await user.click(trigger);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });
});

test('the close button, named from the catalog, closes it with Enter or Space, and so does a button wrapped in DialogClose', async () => {
  const { user } = renderWithProviders(<Settings />);
  const trigger = screen.getByRole('button', { name: 'Open settings' });
  await user.click(trigger);
  screen.getByRole('button', { name: 'Close' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
  await user.click(trigger);
  screen.getByRole('button', { name: 'Close' }).focus();
  await user.keyboard(' ');
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
  await user.click(trigger);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
  await waitFor(() => {
    expect(trigger).toHaveFocus();
  });
});

test('a click on the backdrop outside the dialog closes it, and a click inside does not', async () => {
  const { user } = renderWithProviders(<Settings />);
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  await user.click(screen.getByRole('textbox'));
  expect(dialog()).toBeInTheDocument();
  const backdrop = dialog().parentElement;
  // jsdom has no stylesheet, so the backdrop's `pointer-events: auto` is not there and the page's `none` would refuse the
  // click: 0 is PointerEventsCheck.Never, which user-event does not export by name.
  await userEvent.setup({ pointerEventsCheck: 0 }).click(backdrop ?? document.body);
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
});

test('a controlled dialog asks for the change and stays as the screen leaves it', async () => {
  const onOpenChange = vi.fn();
  const { user, rerender } = renderWithProviders(<Dialog open title="Held" onOpenChange={onOpenChange} />);
  expect(screen.getByRole('dialog', { name: 'Held' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  expect(dialog()).toBeInTheDocument();
  rerender(<Dialog open={false} title="Held" onOpenChange={onOpenChange} />);
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
});

function Opened() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Row action
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Row dialog" />
    </>
  );
}

test('a dialog with no trigger of its own gives focus back to the element that opened it', async () => {
  const { user } = renderWithProviders(<Opened />);
  const rowAction = screen.getByRole('button', { name: 'Row action' });
  await user.click(rowAction);
  expect(dialog()).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(queryDialog()).not.toBeInTheDocument();
  });
  await waitFor(() => {
    expect(rowAction).toHaveFocus();
  });
});

test('a dialog without a description or a footer has none, and opening it writes nothing to the console', async () => {
  const error = vi.spyOn(console, 'error');
  const warn = vi.spyOn(console, 'warn');
  const { user } = renderWithProviders(<Dialog title="Plain" trigger={opener} />);
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  expect(dialog()).not.toHaveAttribute('aria-describedby');
  expect(within(dialog()).getAllByRole('button')).toHaveLength(1);
  expect(error).not.toHaveBeenCalled();
  expect(warn).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

test('opening and closing the dialog adds no <style> element to the page and locks scrolling with a class', async () => {
  const before = styleElements();
  const { user } = renderWithProviders(<Settings />);
  expect(document.documentElement).not.toHaveClass(SCROLL_LOCK_CLASS);
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  expect(document.documentElement).toHaveClass(SCROLL_LOCK_CLASS);
  expect(styleElements()).toBe(before);
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(document.documentElement).not.toHaveClass(SCROLL_LOCK_CLASS);
  });
  expect(styleElements()).toBe(before);
});

test('the open dialog passes axe', async () => {
  const { user } = renderWithProviders(<Settings />);
  await user.click(screen.getByRole('button', { name: 'Open settings' }));
  await expectNoA11yViolations(dialog());
});

test('a hostile name in the title, the description and the body stays text', () => {
  expectHostileNamesInert((name) => {
    const view = renderWithProviders(
      <Dialog
        open
        title={<UserText>{name}</UserText>}
        description={<UserText>{name}</UserText>}
        footer={<UserText>{name}</UserText>}
      >
        <UserText>{name}</UserText>
      </Dialog>,
    );
    return { container: document.body, unmount: view.unmount };
  });
});
