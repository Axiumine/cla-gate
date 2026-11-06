// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { EditorSeed } from './document-queries.ts';
import type { EditorAction, EditorState, Notice, Published } from './editor-state.ts';

// What the editor takes in from the server's answers (E18-S05, E18-S11): a draft or the active version read again, a publish, and the
// restore of an old version. Pure, like the rest of the reducer in `editor-state.ts`.

const LOADED_ACTIVE: Notice = { type: 'loadedActive' };

/** The actions that bring in what the server answered with: a draft or the active version loaded again, a publish, a restore. */
export type ServerAction = Extract<EditorAction, { type: 'loadedDraft' | 'loadedActive' | 'published' | 'restored' }>;

const SERVER_ACTIONS: ReadonlySet<string> = new Set(['loadedDraft', 'loadedActive', 'published', 'restored']);

export function isServerAction(action: EditorAction): action is ServerAction {
  return SERVER_ACTIONS.has(action.type);
}

/** The state after what the server answered with. */
export function afterServer(state: EditorState, action: ServerAction, dirty: boolean): EditorState {
  switch (action.type) {
    case 'loadedDraft':
      return loadedDraft(state, action.draft);
    case 'loadedActive':
      return { ...state, active: action.active, activeText: action.activeText, stale: false, notice: LOADED_ACTIVE };
    case 'published':
      return published(state, action.published);
    case 'restored':
      return restored(state, action.published, action.text, dirty);
  }
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
 * The text of an old version was published again as a new one (E18-S11): that version is the active one now, and `text` is its text. A
 * saved draft is not touched, because a restore does not consume it. With no draft saved the editor shows the active version's text:
 * an editor with nothing unsaved (`dirty` is false) follows it, and typing that is not saved stays and is measured against the new active text.
 */
function restored(state: EditorState, answer: Published, text: string, dirty: boolean): EditorState {
  const hasDraft = state.saved.revision !== null;
  return {
    ...state,
    active: answer.version,
    activeText: text,
    saved: hasDraft ? state.saved : { revision: null, text },
    text: hasDraft || dirty ? state.text : text,
    stale: false,
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
