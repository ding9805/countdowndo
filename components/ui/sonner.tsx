'use client';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { Toaster as Sonner, toast, useSonner } from 'sonner';
import { X } from 'lucide-react';

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Gap between the bottom of the toast stack and the "Clear all" button.
const CLEAR_ALL_GAP_PX = 8;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();
  const { toasts } = useSonner();
  const showClearAll = toasts.length > 1;
  // Where the stack ends, so the button can sit just below it. Toasts
  // animate in and out, so it's tracked every frame, but only while the
  // button is showing.
  const [stackBottom, setStackBottom] = useState<number | null>(null);

  useEffect(() => {
    if (!showClearAll) {
      setStackBottom(null);
      return;
    }
    let frame = 0;
    const measure = () => {
      const visible = document.querySelectorAll<HTMLElement>(
        '[data-sonner-toast][data-visible="true"][data-removed="false"]'
      );
      let bottom = -Infinity;
      visible.forEach((el) => {
        bottom = Math.max(bottom, el.getBoundingClientRect().bottom);
      });
      const next = Number.isFinite(bottom) ? bottom : null;
      setStackBottom((prev) => (prev === next ? prev : next));
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
        position="top-center"
        // With several toasts open, keep the stack expanded: collapsed, it
        // grows when hovered and would cover the "Clear all" button below it.
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
      {showClearAll && stackBottom !== null && (
        <button
          type="button"
          onClick={() => toast.dismiss()}
          style={{ top: stackBottom + CLEAR_ALL_GAP_PX }}
          className="fixed left-1/2 -translate-x-1/2 z-[1000000000] flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground shadow-lg transition-colors hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear all ({toasts.length})
        </button>
      )}
    </>
  );
};

export { Toaster };
