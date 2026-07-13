'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Timer, ArrowLeft, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function ResetPasswordForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'Something went wrong');
        setLoading(false);
        return;
      }

      setSuccess(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="text-center space-y-4">
        <h2 className="text-lg font-semibold text-foreground">Invalid reset link</h2>
        <p className="text-sm text-muted-foreground">
          This password reset link is invalid or has expired.
        </p>
        <Link href="/forgot-password">
          <Button className="w-full gradient-primary hover:opacity-90 text-primary-foreground font-semibold rounded-xl">
            Request a new link
          </Button>
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="text-center space-y-4">
        <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/20 flex items-center justify-center mx-auto">
          <CheckCircle className="w-6 h-6 text-green-400" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">Password reset!</h2>
        <p className="text-sm text-muted-foreground">
          Your password has been updated successfully. You can now log in with your new password.
        </p>
        <Link href="/login">
          <Button className="w-full gradient-primary hover:opacity-90 text-primary-foreground font-semibold rounded-xl">
            Go to login
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <>
      <h2 className="text-lg font-semibold text-foreground mb-2">Set new password</h2>
      <p className="text-sm text-muted-foreground mb-5">
        Enter your new password below.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">New password</label>
          <Input
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            maxLength={72}
            className="bg-secondary/60 border-border/60 focus-visible:border-primary/50"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Confirm password</label>
          <Input
            type="password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={6}
            maxLength={72}
            className="bg-secondary/60 border-border/60 focus-visible:border-primary/50"
          />
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-400/10 rounded-xl px-3 py-2.5 border border-red-400/20">{error}</p>
        )}

        <Button
          type="submit"
          disabled={loading}
          className="w-full gradient-primary hover:opacity-90 text-primary-foreground font-semibold h-11 rounded-xl shadow-md"
        >
          {loading ? 'Resetting...' : 'Reset password'}
        </Button>
      </form>

      <div className="mt-5 text-center">
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5">
          <ArrowLeft className="w-3 h-3" />
          Back to login
        </Link>
      </div>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[500px] h-[500px] rounded-full bg-primary/[0.04] blur-[100px]" />
      </div>

      <div className="w-full max-w-sm relative z-10">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mx-auto mb-5 glow-primary">
            <Timer className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">CountdownDo</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Cumulative time-blocking task manager</p>
        </div>

        <div className="glass-card rounded-2xl p-6" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <Suspense fallback={<div className="text-center text-muted-foreground">Loading...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
