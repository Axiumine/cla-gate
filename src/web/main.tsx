// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
//
// The entry point of the single-page app (E17-S01): it mounts <App /> into #root and does nothing else. Everything the
// app does lives in App.tsx and below, where it is tested. The first import is the setting of Zod (zod-config.ts), which
// must run before any module builds a schema.
import './zod-config.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('index.html has no #root element to mount the app into');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
