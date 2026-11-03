// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { useT } from '../i18n/index.ts';
import { RadioGroup } from '../ui/RadioGroup.tsx';
import { useTheme } from './context.ts';
import { THEME_MODES } from './model.ts';

/** What a radio of the group can hand back: one of the three modes. Radix only ever gives a value of its items. */
const modeSchema = z.enum(THEME_MODES);

/**
 * The choice of theme (E17-S09): "System", "Light" and "Dark" as one radio group, named by the catalog. It is one tab stop;
 * the arrow keys move between the three and choose the one they land on, so the page changes as the key is pressed. It reads
 * and writes the mode through `useTheme()` (E17-S05), which applies it to the page and remembers it.
 */
export function ThemeToggle() {
  const t = useT();
  const { mode, setMode } = useTheme();
  return (
    <RadioGroup
      aria-label={t('theme.label')}
      value={mode}
      onValueChange={(value) => {
        setMode(modeSchema.parse(value));
      }}
      options={THEME_MODES.map((value) => ({ value, label: t(`theme.${value}`) }))}
      className="flex-row! flex-wrap items-center gap-3"
    />
  );
}
