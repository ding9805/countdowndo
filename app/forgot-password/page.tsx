'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Timer, ArrowLeft, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || 'Something went wrong');
        setLoading(false);
        return;
      }

      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
          {sent ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 rounded-full bg-green-500/15 border border-green-500/20 flex items-center justify-center mx-auto">
                <Mail className="w-6 h-6 text-green-400" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                If an account exists for <span className="text-foreground font-medium">{email}</span>, we've sent a password reset link. It expires in 1 hour.
              </p>
              <p className="text-xs text-muted-foreground">
                Don't see it? Check your spam folder.
              </p>
              <Link href="/login">
                <Button variant="outline" className="w-full mt-2 border-primary/40 text-primary hover:bg-primary/10 rounded-xl">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back to login
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground mb-2">Forgot password?</h2>
              <p className="text-sm text-muted-foreground mb-5">
                Enter your email and we'll send you a link to reset your password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Email</label>
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
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
                  {loading ? 'Sending...' : 'Send reset link'}
                </Button>
              </form>

              <div className="mt-5 text-center">
                <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5">
                  <ArrowLeft className="w-3 h-3" />
                  Back to login
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
