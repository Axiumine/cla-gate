// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { publishVersionRoute } from '../../shared/cla-routes.ts';
import type { SuccessOf } from '../../shared/contract.ts';
import type { EditorSeed } from './document-queries.ts';

// What the editor of a document holds and how it changes (E18-S05), as one pure reducer so every rule about the text, the saved
// draft, the active version and the notices is tested without a screen. The draft is on the server and shared by every admin of
// the scope; this state is the copy of it that the person is editing.

/** The version a document is signed against, as the API tells it. */
export type ActiveVersion = NonNullable<EditorSeed['document']['activeVersion']>;

/** The answer of a publish: the version, whether signers must sign again and how many signatures that affects. */
export type Published = SuccessOf<typeof publishVersionRoute>;

/** The draft as the server holds it: its revision (`null` when none is saved) and the text it had when it was read or saved. */
interface SavedState {
  readonly revision: number | null;
  readonly text: string;
}

/** What the status region says: the last thing that happened to the draft or the version, until the next one. */
export type Notice =
  | { readonly type: 'saved' }
  | { readonly type: 'discarded' }
  | { readonly type: 'loadedDraft' }
  | { readonly type: 'loadedActive' }
  | { readonly type: 'published'; readonly published: Published };

export interface EditorState {
  /** What the textarea shows. */
  readonly text: string;
  readonly saved: SavedState;
  readonly active: ActiveVersion | null;
  /** The text of the active version: what the editor shows when no draft is saved, and `''` for a document with no version. */
  readonly activeText: string;
  /** Another admin saved the draft while this one was editing (`409 draft_conflict`): the local text is kept until "Load latest". */
  readonly conflict: boolean;
  /** Another admin published while this one worked (`409 stale_active_version`). */
  readonly stale: boolean;
  /** The publish dialog is open. A conflict, a stale version and a publish close it: the notice is what the person needs to see next. */
  readonly publishing: boolean;
  readonly notice: Notice | undefined;
}

export type EditorAction =
  | { readonly type: 'edit'; readonly text: string }
  | { readonly type: 'publishing'; readonly open: boolean }
  | { readonly type: 'saved'; readonly revision: number; readonly text: string }
  | { readonly type: 'discarded' }
  | { readonly type: 'conflict' }
  | { readonly type: 'stale' }
  | { readonly type: 'loadedDraft'; readonly draft: EditorSeed['draft'] }
  | { readonly type: 'loadedActive'; readonly active: ActiveVersion | null; readonly activeText: string }
  | { readonly type: 'published'; readonly published: Published };

/** The state the editor opens in: the saved draft when there is one, else the active version's text, else nothing. */
export function initialEditorState(seed: EditorSeed): EditorState {
  const saved: SavedState =
    seed.draft === null
      ? { revision: null, text: seed.activeText }
      : { revision: seed.draft.revision, text: seed.draft.contentMd };
  return {
    text: saved.text,
    saved,
    active: seed.document.activeVersion,
    activeText: seed.activeText,
    conflict: false,
    stale: false,
    publishing: false,
    notice: undefined,
  };
}

/** Whether the text on screen differs from the text the server holds as the draft (or, with no draft, from the active version). */
export function isDirty(state: EditorState): boolean {
  return state.text !== state.saved.text;
}

const SAVED: Notice = { type: 'saved' };
const LOADED_ACTIVE: Notice = { type: 'loadedActive' };

/** The state after `action`. */
export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'edit':
      return edited(state, action.text);
    case 'publishing':
      return { ...state, publishing: action.open };
    case 'saved':
      return { ...state, saved: { revision: action.revision, text: action.text }, conflict: false, notice: SAVED };
    case 'discarded':
      return discarded(state);
    case 'conflict':
      return { ...state, conflict: true, publishing: false };
    case 'stale':
      return { ...state, stale: true, publishing: false };
    case 'loadedDraft':
      return loadedDraft(state, action.draft);
    case 'loadedActive':
      return { ...state, active: action.active, activeText: action.activeText, stale: false, notice: LOADED_ACTIVE };
    case 'published':
      return published(state, action.published);
  }
}

/** A key press: the text changes, and "Draft saved" stops being true of what is on screen; any other notice stays. */
function edited(state: EditorState, text: string): EditorState {
  return { ...state, text, notice: state.notice?.type === 'saved' ? undefined : state.notice };
}

/** The draft is gone from the server: the editor goes back to the active version's text, and the changes that were not saved go with it. */
function discarded(state: EditorState): EditorState {
  return {
    ...state,
    text: state.activeText,
    saved: { revision: null, text: state.activeText },
    conflict: false,
    notice: { type: 'discarded' },
  };
}

/** The draft was consumed by the publish: the version it made is the active one, and no draft is saved any more. */
function published(state: EditorState, answer: Published): EditorState {
  return {
    ...state,
    active: answer.version,
    activeText: state.saved.text,
    saved: { revision: null, text: state.saved.text },
    conflict: false,
    stale: false,
    publishing: false,
    notice: { type: 'published', published: answer },
  };
}

/**
 * "Load latest" after a conflict: the draft another admin saved replaces the text on screen. When that draft has been discarded
 * meanwhile there is nothing to load, so the text on screen stays, and it is now unsaved work on top of the active version.
 */
function loadedDraft(state: EditorState, draft: EditorSeed['draft']): EditorState {
  if (draft === null) {
    return { ...state, saved: { revision: null, text: state.activeText }, conflict: false, notice: undefined };
  }
  return {
    ...state,
    text: draft.contentMd,
    saved: { revision: draft.revision, text: draft.contentMd },
    conflict: false,
    notice: { type: 'loadedDraft' },
  };
}
