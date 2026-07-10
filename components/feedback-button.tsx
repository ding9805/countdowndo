'use client';

import React, { useState } from 'react';
import { MessageSquarePlus, X, Send, Bug, Lightbulb, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';

type Category = 'bug' | 'feature' | 'general';

const categories: { value: Category; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'bug', label: 'Bug Report', icon: <Bug className="w-4 h-4" />, color: 'text-red-400 bg-red-400/10 border-red-400/30 hover:bg-red-400/20' },
  { value: 'feature', label: 'Feature Request', icon: <Lightbulb className="w-4 h-4" />, color: 'text-amber-400 bg-amber-400/10 border-amber-400/30 hover:bg-amber-400/20' },
  { value: 'general', label: 'General', icon: <MessageCircle className="w-4 h-4" />, color: 'text-blue-400 bg-blue-400/10 border-blue-400/30 hover:bg-blue-400/20' },
];

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category | null>(null);
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category || message.trim().length < 10) return;

    setLoading(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          message: message.trim(),
          email: email.trim() || undefined,
          website: '', // honeypot — must be empty
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || 'Failed to submit feedback');
        setLoading(false);
        return;
      }

      setSubmitted(true);
      setTimeout(() => {
        setOpen(false);
        setSubmitted(false);
        setCategory(null);
        setMessage('');
        setEmail('');
      }, 2000);
    } catch (err) {
      toast.error('Failed to submit feedback. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setOpen(false);
    setSubmitted(false);
    setCategory(null);
    setMessage('');
    setEmail('');
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 p-3 rounded-full gradient-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 glow-primary"
        title="Send feedback"
      >
        <MessageSquarePlus className="w-5 h-5" />
      </button>

      {/* Modal overlay */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
              onClick={reset}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="fixed bottom-20 right-6 z-50 w-[380px] max-w-[calc(100vw-48px)]"
            >
              <div className="glass-card rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--shadow-lg)' }}>
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                  <h3 className="font-display font-semibold text-foreground">Send Feedback</h3>
                  <button onClick={reset} className="p-1 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {submitted ? (
                  <div className="px-5 py-10 text-center">
                    <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-3">
                      <span className="text-2xl">✓</span>
                    </div>
                    <p className="text-foreground font-medium">Thank you!</p>
                    <p className="text-sm text-muted-foreground mt-1">Your feedback has been submitted.</p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {/* Category selection */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-2 block">Category</label>
                      <div className="flex gap-2">
                        {categories.map((cat) => (
                          <button
                            key={cat.value}
                            type="button"
                            onClick={() => setCategory(cat.value)}
                            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                              category === cat.value
                                ? cat.color + ' border-current'
                                : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground'
                            }`}
                          >
                            {cat.icon}
                            <span className="hidden sm:inline">{cat.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Message */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Your feedback</label>
                      <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                        placeholder="Tell us what you think... (min 10 characters)"
                        rows={4}
                        className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-input resize-none"
                      />
                      <p className="text-xs text-muted-foreground mt-1 text-right">{message.length}/2000</p>
                    </div>

                    {/* Optional email */}
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Email <span className="text-muted-foreground/60">(optional, if you want a reply)</span></label>
                      <Input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="bg-secondary/50 border-border text-sm"
                      />
                    </div>

                    {/* Honeypot — hidden from real users */}
                    <div className="absolute -left-[9999px]" aria-hidden="true">
                      <input type="text" name="website" tabIndex={-1} autoComplete="off" />
                    </div>

                    {/* Submit */}
                    <Button
                      type="submit"
                      disabled={loading || !category || message.trim().length < 10}
                      className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium"
                    >
                      {loading ? (
                        'Sending...'
                      ) : (
                        <><Send className="w-4 h-4 mr-2" /> Submit Feedback</>
                      )}
                    </Button>
                  </form>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
