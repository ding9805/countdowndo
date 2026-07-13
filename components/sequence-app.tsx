'use client';

import React, { useState } from 'react';
import { useSessionEngine } from '@/hooks/use-session-engine';
import { TaskInputPanel } from './task-input-panel';
import { ActiveSession } from './active-session';
import { CompletionHistory } from './completion-history';
import { Dashboard } from './dashboard';
import { TaskBankPickerDialog } from './task-bank/task-bank-picker-dialog';
import { PageToggle } from './page-toggle';
import { Timer, ListChecks, LogOut, LogIn, AlertTriangle, X, History, BarChart3 } from 'lucide-react';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';

export function SequenceApp() {
  const { data: authSession, status: authStatus } = useSession() || {};
  const isLoggedIn = authStatus === 'authenticated' && !!authSession?.user;
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'history' | 'dashboard'>('history');
  const [bankPickerOpen, setBankPickerOpen] = useState(false);

  const {
    tasks,
    sessionState,
    sessionStartTime,
    pausedElapsed,
    elapsedSeconds,
    sessionMode,
    setSessionMode,
    sessionTotalSeconds,
    taskOrder,
    toggleTaskOrder,
    planningStartTime,
    setPlanningStartTime,
    isSession,
    getRemainingTime,
    getProgress,
    handleStartSession,
    handlePause,
    handleStop,
    handleMarkDone,
    handleAddTask,
    handleAddFromBank,
    handleDeleteTask,
    handleEditTask,
    handleReorder,
  } = useSessionEngine(isLoggedIn);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-3 sm:py-3.5 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center glow-primary shrink-0">
              <Timer className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-foreground">
              CountdownDo
            </h1>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-4 flex-wrap">
            <PageToggle />
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary/40 px-2.5 sm:px-3 py-1.5 rounded-full">
              <ListChecks className="w-3.5 h-3.5" />
              <span className="text-xs font-medium">{tasks?.length ?? 0}<span className="hidden sm:inline"> task{(tasks?.length ?? 0) !== 1 ? 's' : ''}</span></span>
            </div>
            {isLoggedIn ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {authSession?.user?.email}
                </span>
                <button
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="p-2 rounded-xl hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-all"
                  title="Log out"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-2 px-2.5 sm:px-4 py-2 rounded-xl gradient-primary text-primary-foreground hover:opacity-90 transition-all text-sm font-semibold shadow-md"
                title="Log in"
              >
                <LogIn className="w-4 h-4" />
                <span className="hidden sm:inline">Log in</span>
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Guest warning banner */}
      {!isLoggedIn && authStatus !== 'loading' && !warningDismissed && (
        <div className="bg-amber-500/[0.06] border-b border-amber-500/15">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 text-sm">
              <div className="p-1.5 rounded-lg bg-amber-500/10">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
              </div>
              <p className="text-amber-200/80 text-xs">
                You are not logged in. Your tasks and lists <strong className="text-amber-200">will not be saved</strong> — a page refresh will reset everything.{' '}
                <Link href="/login" className="text-primary hover:underline font-medium">Create an account</Link>{' '}
                to save your data and sync across devices.
              </p>
            </div>
            <button
              onClick={() => setWarningDismissed(true)}
              className="p-1.5 rounded-lg hover:bg-amber-500/15 text-amber-400/50 hover:text-amber-400 transition-colors flex-shrink-0"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="max-w-[1200px] mx-auto px-6 py-8">
        <div className="mb-8 text-center">
          <p className="text-muted-foreground text-sm">
            Plan your tasks with cumulative time-blocking, then start the session to track everything at once.
          </p>
        </div>

        <div className={`grid grid-cols-1 ${isLoggedIn ? 'lg:grid-cols-[1fr_340px]' : ''} gap-8`}>
          <div>
            {!isSession ? (
              <TaskInputPanel
                tasks={tasks}
                sessionMode={sessionMode}
                taskOrder={taskOrder}
                planningStartTime={planningStartTime}
                onToggleOrder={toggleTaskOrder}
                onPlanningStartTimeChange={setPlanningStartTime}
                onSessionModeChange={setSessionMode}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                onEditTask={handleEditTask}
                onReorder={handleReorder}
                onStartSession={handleStartSession}
                onOpenTaskBank={() => setBankPickerOpen(true)}
              />
            ) : (
              <ActiveSession
                tasks={tasks}
                sessionState={sessionState}
                sessionMode={sessionMode}
                sessionTotalSeconds={sessionTotalSeconds}
                elapsedSeconds={elapsedSeconds}
                sessionStartTimestamp={sessionStartTime ?? 0}
                pausedElapsed={pausedElapsed}
                taskOrder={taskOrder}
                onToggleOrder={toggleTaskOrder}
                getRemainingTime={getRemainingTime}
                getProgress={getProgress}
                onMarkDone={handleMarkDone}
                onPause={handlePause}
                onStop={handleStop}
                onAddTask={handleAddTask}
                onDeleteTask={handleDeleteTask}
                onEditTask={handleEditTask}
                onReorder={handleReorder}
                onOpenTaskBank={() => setBankPickerOpen(true)}
              />
            )}
          </div>

          {/* Sidebar - saved lists & history */}
          {isLoggedIn && (
            <div className="space-y-4">
              {/* Tab switcher */}
              <div className="flex rounded-xl bg-secondary/30 p-1 border border-border/40 glass-card">
                <button
                  onClick={() => setSidebarTab('history')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    sidebarTab === 'history'
                      ? 'bg-primary/15 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  }`}
                >
                  <History className="w-3.5 h-3.5" />
                  History
                </button>
                <button
                  onClick={() => setSidebarTab('dashboard')}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                    sidebarTab === 'dashboard'
                      ? 'bg-primary/15 text-primary shadow-sm'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Stats
                </button>
              </div>

              {sidebarTab === 'history' ? (
                <CompletionHistory isLoggedIn={isLoggedIn} />
              ) : (
                <Dashboard isLoggedIn={isLoggedIn} />
              )}
            </div>
          )}
        </div>

        {/* Guest history & dashboard section - shown below main content */}
        {!isLoggedIn && authStatus !== 'loading' && (
          <div className="mt-8 space-y-8">
            <Dashboard isLoggedIn={false} />
            <CompletionHistory isLoggedIn={false} />
          </div>
        )}
      </div>

      <TaskBankPickerDialog
        open={bankPickerOpen}
        onOpenChange={setBankPickerOpen}
        onConfirm={handleAddFromBank}
        confirmLabel={isSession ? 'Add to Session' : 'Add Tasks'}
      />
    </div>
  );
}
