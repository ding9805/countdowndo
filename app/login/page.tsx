'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isSignup) {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data?.error || 'Signup failed');
          setLoading(false);
          return;
        }
        const signInResult = await signIn('credentials', {
          email,
          password,
          redirect: false,
        });
        if (signInResult?.error) {
          setError('Account created but login failed. Please try logging in.');
          setIsSignup(false);
          setLoading(false);
          return;
        }
        router.replace('/');
      } else {
        const result = await signIn('credentials', {
          email,
          password,
          redirect: false,
        });
        if (result?.error) {
          setError('Invalid email or password');
          setLoading(false);
          return;
        }
        router.replace('/');
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 relative">
      {/* Ambient background glow */}
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
          <h2 className="text-lg font-semibold text-foreground mb-5">
            {isSignup ? 'Create an account' : 'Welcome back'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Name</label>
                <Input
                  type="text"
                  placeholder="Your name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-secondary/60 border-border/60 focus-visible:border-primary/50"
                />
              </div>
            )}
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
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Password</label>
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

            {!isSignup && (
              <div className="text-right -mt-2">
                <Link href="/forgot-password" className="text-xs text-primary/80 hover:text-primary hover:underline transition-colors">
                  Forgot password?
                </Link>
              </div>
            )}

            {error && (
              <p className="text-sm text-red-400 bg-red-400/10 rounded-xl px-3 py-2.5 border border-red-400/20">{error}</p>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full gradient-primary hover:opacity-90 text-primary-foreground font-semibold h-11 rounded-xl shadow-md"
            >
              {loading ? 'Please wait...' : isSignup ? 'Sign up' : 'Log in'}
            </Button>
          </form>

          <div className="mt-5 pt-5 border-t border-border/40 text-center">
            <button
              onClick={() => { setIsSignup(!isSignup); setError(''); }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {isSignup ? 'Already have an account? ' : "Don't have an account? "}
              <span className="text-primary font-medium">{isSignup ? 'Log in' : 'Sign up'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
