'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Archive, Timer, Target, Settings } from 'lucide-react';

export function PageToggle() {
  const pathname = usePathname();
  const isTaskBank = pathname === '/bank';
  const isSession = pathname === '/';
  const isGoals = pathname === '/goals';
  const isSettings = pathname === '/settings';

  return (
    <div className="inline-flex items-center rounded-full bg-secondary/40 p-1 border border-border/40 gap-0.5">
      <Link
        href="/"
        className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          isSession ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Timer className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Session</span>
      </Link>
      <Link
        href="/bank"
        className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          isTaskBank ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Archive className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Task Bank</span>
      </Link>
      <Link
        href="/goals"
        className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          isGoals ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        <Target className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Goals</span>
      </Link>
      <Link
        href="/settings"
        className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
          isSettings ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
        aria-label="Settings"
      >
        <Settings className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Settings</span>
      </Link>
    </div>
  );
}
