'use client';

import { Button } from '@fusai/ui/components/button';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  return (
    <Button
      variant="ghost"
      size="icon"
      // Static label: the theme is only known on the client, so a theme-dependent label would
      // differ from the server render (hydration mismatch). The icons switch via CSS.
      aria-label="Alternar entre tema claro e escuro"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      <Sun className="hidden dark:block" />
      <Moon className="dark:hidden" />
    </Button>
  );
}
