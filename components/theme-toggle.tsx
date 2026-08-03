'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { readThemeMode, THEME_MODE_STORAGE_KEY, type AppliedTheme } from '@/lib/theme'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [currentTheme, setCurrentTheme] = useState<AppliedTheme>('dark')

  useEffect(() => {
    setMounted(true)
    const mode = readThemeMode()
    setCurrentTheme(mode === 'auto' ? (resolvedTheme === 'light' ? 'light' : 'dark') : mode)

    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_MODE_STORAGE_KEY) {
        const nextMode = readThemeMode()
        setCurrentTheme(nextMode === 'auto' ? (resolvedTheme === 'light' ? 'light' : 'dark') : nextMode)
      }
    }

    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [resolvedTheme])

  const toggleTheme = () => {
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark'
    localStorage.setItem(THEME_MODE_STORAGE_KEY, nextTheme)
    setCurrentTheme(nextTheme)
    setTheme(nextTheme)
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      title={mounted ? `Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle theme'}
      aria-label={mounted ? `Switch to ${currentTheme === 'dark' ? 'light' : 'dark'} mode` : 'Toggle theme'}
    >
      {mounted ? (currentTheme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />) : <span className="h-4 w-4" />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
