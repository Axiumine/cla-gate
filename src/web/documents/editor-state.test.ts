// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { describe, expect, test } from 'vitest';
import type { EditorSeed } from './document-queries.ts';
import { type EditorAction, type EditorState, editorReducer, initialEditorState, isDirty } from './editor-state.ts';
import { listedOf, versionOf } from './test-support.ts';

// E18-S05: what the editor holds and how it changes, as one reducer: the text, the saved draft, the active version and the notices.

const WHEN = '2026-10-02T10:00:00.000Z';
const DRAFT = { contentMd: 'the draft', revision: 3, updatedAt: WHEN };
const OPENED: EditorSeed = { document: listedOf(), draft: null, activeText: 'the active text' };

const run = (state: EditorState, ...actions: EditorAction[]): EditorState => actions.reduce(editorReducer, state);

describe('the state the editor opens in', () => {
  test('is the saved draft when there is one: its text, its revision, and the active version beside it', () => {
    const state = initialEditorState({ ...OPENED, draft: DRAFT });
    expect(state.text).toBe('the draft');
    expect(state.saved).toEqual({ revision: 3, text: 'the draft' });
    expect(state.active?.major).toBe(1);
    expect(state.activeText).toBe('the active text');
  });

  test('is the text of the active version when no draft is saved, with no revision', () => {
    const state = initialEditorState(OPENED);
    expect(state.text).toBe('the active text');
    expect(state.saved).toEqual({ revision: null, text: 'the active text' });
  });

  test('is an empty editor for a document with no version and no draft', () => {
    const state = initialEditorState({ document: listedOf({ activeVersion: null }), draft: null, activeText: '' });
    expect(state.text).toBe('');
    expect(state.active).toBeNull();
  });

  test('has no conflict, no stale version, no dialog and no notice', () => {
    const state = initialEditorState(OPENED);
    expect([state.conflict, state.stale, state.publishing, state.notice]).toEqual([false, false, false, undefined]);
  });
});

describe('unsaved work', () => {
  test('is a text that differs from the saved one, and goes away when the text is typed back', () => {
    const opened = initialEditorState(OPENED);
    const edited = run(opened, { type: 'edit', text: 'changed' });
    expect(isDirty(opened)).toBe(false);
    expect(isDirty(edited)).toBe(true);
    expect(isDirty(run(edited, { type: 'edit', text: 'the active text' }))).toBe(false);
  });

  test('is cleared by a save, which makes the text on screen the draft at the new revision', () => {
    const saved = run(
      initialEditorState(OPENED),
      { type: 'edit', text: 'changed' },
      { type: 'saved', revision: 4, text: 'changed' },
    );
    expect(isDirty(saved)).toBe(false);
    expect(saved.saved).toEqual({ revision: 4, text: 'changed' });
    expect(saved.notice).toEqual({ type: 'saved' });
  });

  test('is kept by a save of an older text: what was typed while the request was out is still unsaved', () => {
    const state = run(
      initialEditorState(OPENED),
      { type: 'edit', text: 'one' },
      { type: 'edit', text: 'one two' },
      { type: 'saved', revision: 4, text: 'one' },
    );
    expect(state.text).toBe('one two');
    expect(isDirty(state)).toBe(true);
  });
});

describe('the notices', () => {
  test('"Draft saved" stops being said when the text changes, and any other notice stays', () => {
    const saved = run(initialEditorState(OPENED), { type: 'saved', revision: 4, text: 'the active text' });
    expect(run(saved, { type: 'edit', text: 'x' }).notice).toBeUndefined();
    const loaded = run(initialEditorState(OPENED), { type: 'loadedActive', active: null, activeText: 'z' });
    expect(run(loaded, { type: 'edit', text: 'x' }).notice).toEqual({ type: 'loadedActive' });
  });

  test('the publish dialog opens and closes', () => {
    const opened = run(initialEditorState(OPENED), { type: 'publishing', open: true });
    expect(opened.publishing).toBe(true);
    expect(run(opened, { type: 'publishing', open: false }).publishing).toBe(false);
  });
});

describe('a discard', () => {
  test('goes back to the text of the active version, with no draft, and drops the changes that were not saved', () => {
    const state = run(
      initialEditorState({ ...OPENED, draft: DRAFT }),
      { type: 'edit', text: 'more work' },
      { type: 'conflict' },
      { type: 'discarded' },
    );
    expect(state.text).toBe('the active text');
    expect(state.saved).toEqual({ revision: null, text: 'the active text' });
    expect(state.conflict).toBe(false);
    expect(state.notice).toEqual({ type: 'discarded' });
  });
});

describe('a conflict', () => {
  test('a conflict keeps the local text and its changes, closes the publish dialog and waits for "Load latest"', () => {
    const state = run(
      initialEditorState(OPENED),
      { type: 'edit', text: 'mine' },
      { type: 'publishing', open: true },
      { type: 'conflict' },
    );
    expect(state.conflict).toBe(true);
    expect(state.publishing).toBe(false);
    expect(state.text).toBe('mine');
  });

  test('"Load latest" of the draft replaces the text with the draft of the other admin and clears the conflict', () => {
    const state = run(
      initialEditorState(OPENED),
      { type: 'edit', text: 'mine' },
      { type: 'conflict' },
      { type: 'loadedDraft', draft: DRAFT },
    );
    expect(state.text).toBe('the draft');
    expect(state.saved).toEqual({ revision: 3, text: 'the draft' });
    expect(state.conflict).toBe(false);
    expect(state.notice).toEqual({ type: 'loadedDraft' });
  });

  test('"Load latest" when the other admin discarded the draft keeps the local text as unsaved work on the active version', () => {
    const state = run(
      initialEditorState({ ...OPENED, draft: DRAFT }),
      { type: 'edit', text: 'mine' },
      { type: 'conflict' },
      { type: 'loadedDraft', draft: null },
    );
    expect(state.text).toBe('mine');
    expect(state.saved).toEqual({ revision: null, text: 'the active text' });
    expect(isDirty(state)).toBe(true);
    expect(state.conflict).toBe(false);
    expect(state.notice).toBeUndefined();
  });
});

describe('a newer version', () => {
  test('a newer version closes the publish dialog and keeps the draft on screen', () => {
    const state = run(
      initialEditorState({ ...OPENED, draft: DRAFT }),
      { type: 'publishing', open: true },
      { type: 'stale' },
    );
    expect(state.stale).toBe(true);
    expect(state.publishing).toBe(false);
    expect(state.text).toBe('the draft');
  });

  test('"Load latest" of the version makes it the active one, with its text, and clears the warning; the draft stays', () => {
    const newer = versionOf({ id: 302, major: 2, minor: 1 });
    const state = run(
      initialEditorState({ ...OPENED, draft: DRAFT }),
      { type: 'stale' },
      { type: 'loadedActive', active: newer, activeText: 'newer text' },
    );
    expect(state.active).toEqual(newer);
    expect(state.activeText).toBe('newer text');
    expect(state.stale).toBe(false);
    expect(state.text).toBe('the draft');
    expect(state.notice).toEqual({ type: 'loadedActive' });
  });
});

describe('a publish', () => {
  test('makes the new version the active one, consumes the draft, and keeps the text on screen as the active text', () => {
    const published = {
      version: versionOf({ id: 302, major: 2, minor: 0 }),
      requiresResigning: true,
      affectedSignatures: 4,
    };
    const state = run(
      initialEditorState({ ...OPENED, draft: DRAFT }),
      { type: 'publishing', open: true },
      { type: 'published', published },
    );
    expect(state.active).toEqual(published.version);
    expect(state.activeText).toBe('the draft');
    expect(state.saved).toEqual({ revision: null, text: 'the draft' });
    expect(state.text).toBe('the draft');
    expect([state.publishing, state.conflict, state.stale]).toEqual([false, false, false]);
    expect(state.notice).toEqual({ type: 'published', published });
  });
});
