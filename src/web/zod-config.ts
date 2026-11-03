// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// Zod's switch for the browser (E17-S03): by default Zod 4 probes `new Function('')` when it builds its first object schema,
// to learn whether it may compile a faster parser. The page's Content-Security-Policy has no `unsafe-eval`, so the probe
// throws, Zod catches it and carries on, but the browser reports a `securitypolicyviolation` for it on every page load,
// and the end-to-end run of E18-S12 asserts there are none. `jitless` skips the probe and the compiled parser; the interpreted
// one is the same in every result. Zod reads the setting when each schema is built, so this module is the first import of
// main.tsx, before any module that builds one (src/shared included), and scripts/web/zod-jitless.test.ts pins both.
z.config({ jitless: true });
