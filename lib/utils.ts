import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
 
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// True while an input method (Chinese, Japanese, Korean…) is composing text.
// Enter then confirms a candidate and Escape cancels it, so key handlers must
// leave those keys alone. keyCode 229 covers Safari, which reports the
// confirming keydown after composition has ended.
export function isComposingKey(event: { nativeEvent: { isComposing?: boolean }; keyCode?: number }): boolean {
  return !!event.nativeEvent.isComposing || event.keyCode === 229
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = seconds % 60

  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}