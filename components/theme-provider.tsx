"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes"
import { type ThemeProviderProps } from "next-themes/dist/types"
import { getAutomaticTheme, readThemeMode, THEME_MODE_STORAGE_KEY } from '@/lib/theme'

function AutomaticThemeSync() {
  const { setTheme } = useTheme()

  React.useEffect(() => {
    const applyTheme = () => {
      const mode = readThemeMode();
      if (mode === 'auto') setTheme(getAutomaticTheme());
    };

    applyTheme();
    const interval = window.setInterval(applyTheme, 60_000);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_MODE_STORAGE_KEY) applyTheme();
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', handleStorage);
    };
  }, [setTheme]);

  return null;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider {...props}>
      <AutomaticThemeSync />
      {children}
    </NextThemesProvider>
  )
}
