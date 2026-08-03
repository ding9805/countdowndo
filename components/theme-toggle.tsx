'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun, SunMoon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getAutomaticTheme,
  isThemeMode,
  readThemeMode,
  THEME_MODE_STORAGE_KEY,
  type ThemeMode,
} from '@/lib/theme'

export function ThemeToggle() {
  const { setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [mode, setMode] = useState<ThemeMode>('auto')

  useEffect(() => {
    setMounted(true)
    setMode(readThemeMode())

    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_MODE_STORAGE_KEY) setMode(readThemeMode())
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const selectMode = (value: string) => {
    if (!isThemeMode(value)) return

    localStorage.setItem(THEME_MODE_STORAGE_KEY, value)
    setMode(value)
    setTheme(value === 'auto' ? getAutomaticTheme() : value)
  }

  const currentIcon = mode === 'auto'
    ? <SunMoon className="h-4 w-4" />
    : mode === 'dark'
    ? <Moon className="h-4 w-4" />
    : <Sun className="h-4 w-4" />
  const modeLabel = mode === 'auto' ? 'Automatic' : mode === 'dark' ? 'Dark' : 'Light'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          title={mounted ? `${modeLabel} theme` : 'Theme settings'}
          aria-label={mounted ? `${modeLabel} theme` : 'Theme settings'}
        >
          {mounted ? currentIcon : <span className="h-4 w-4" />}
          <span className="sr-only">Theme settings</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mounted ? mode : 'auto'} onValueChange={selectMode}>
          <DropdownMenuRadioItem value="auto">
            <SunMoon className="mr-2 h-4 w-4" />
            Automatic (local time)
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">
            <Sun className="mr-2 h-4 w-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
