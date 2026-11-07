// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { readText } from './ci/lib/test-support.ts';

// E21: `eslint .` reads the type information of the whole repository in one process (docs/tooling-gotchas.md), and its heap went past
// the default limit of Node, about 4.2 GB. The script that CI, the pre-push hook and `yarn lint` run gives it room.

const packageSchema = z.object({ scripts: z.record(z.string(), z.string()) });
const { scripts } = packageSchema.parse(JSON.parse(readText(path.resolve(import.meta.dirname, '../package.json'))));

test('yarn lint:eslint runs ESLint over the whole repository with a heap of at least 6 GiB and no warning allowed', () => {
  const match =
    /^NODE_OPTIONS=--max-old-space-size=(?<megabytes>\d+) eslint \. --max-warnings 0 --no-warn-ignored$/u.exec(
      scripts['lint:eslint'] ?? '',
    );
  expect(Number(match?.groups?.['megabytes'])).toBeGreaterThanOrEqual(6144);
});
