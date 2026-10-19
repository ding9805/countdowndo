'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, toast, useSonner } from 'sonner';
import { X } from 'lucide-react';

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Gap between the top of the toast stack and the "Clear all" button.
const CLEAR_ALL_GAP_PX = 8;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();
  const { toasts } = useSonner();
  const showClearAll = toasts.length > 1;
  // Distance from the bottom of the viewport to the top of the stack, so the
  // button can sit just above it. Toasts animate in and out, so it's tracked
  // every frame, but only while the button is showing.
  const [stackTop, setStackTop] = useState<number | null>(null);

  useEffect(() => {
    if (!showClearAll) {
      setStackTop(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const visible = document.querySelectorAll<HTMLElement>(
        '[data-sonner-toast][data-visible="true"][data-removed="false"]'
      );
      let top = Infinity;
      visible.forEach((el) => {
        top = Math.min(top, el.getBoundingClientRect().top);
      });
      const next = Number.isFinite(top) ? window.innerHeight - top : null;
      setStackTop((prev) => (prev === next ? prev : next));
      frame = requestAnimationFrame(measure);
    };
    measure();
    return () => cancelAnimationFrame(frame);
  }, [showClearAll]);

  return (
    <>
      <Sonner
        theme={theme as ToasterProps['theme']}
        className="toaster group"
        closeButton
        // With several toasts open, keep the stack expanded: collapsed, it
        // grows when hovered and would cover the "Clear all" button above it.
        expand={showClearAll}
        toastOptions={{
          classNames: {
            toast:
              'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
            description: 'group-[.toast]:text-muted-foreground',
            actionButton:
              'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
            cancelButton:
              'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          },
        }}
        {...props}
      />
      {showClearAll && stackTop !== null && (
        <button
          type="button"
          onClick={() => toast.dismiss()}
          style={{ bottom: stackTop + CLEAR_ALL_GAP_PX }}
          className="fixed right-4 sm:right-8 z-[1000000000] flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-lg transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear all ({toasts.length})
        </button>
      )}
    </>
  );
};

export { Toaster };
