'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

const DISMISSED_KEY = 'domain-notice-dismissed-at';
const REAPPEAR_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function DomainNoticeBanner() {
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem(DISMISSED_KEY));
    setDismissed(Boolean(dismissedAt) && Date.now() - dismissedAt < REAPPEAR_AFTER_MS);
  }, []);

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    setDismissed(true);
  };

  return (
    <div className="sticky top-0 z-[60] w-full bg-amber-500/15 border-b border-amber-500/30 text-amber-200 backdrop-blur-sm">
      <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 px-4 py-2 pr-10 text-center text-xs sm:text-sm relative">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <p>
          Heads up: <span className="font-medium">countdowndo.com</span> may stop working at some
          point. Bookmark{' '}
          <a
            href="https://countdowndo-three.vercel.app"
            className="font-semibold underline underline-offset-2 hover:text-amber-100"
          >
            countdowndo-three.vercel.app
          </a>{' '}
          to make sure you always have access.
        </p>
        <button
          onClick={dismiss}
          aria-label="Dismiss domain notice"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-amber-500/20 text-amber-300 hover:text-amber-100 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
