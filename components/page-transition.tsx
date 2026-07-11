'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { usePathname } from 'next/navigation';

// The two paired views this animation ties together — Task Bank and Session
// are meant to feel like adjacent tabs of one flow, not separate pages.
const PAIRED_ROUTES = ['/', '/session'];

const variants = {
  enter: (direction: number) => ({ opacity: 0, x: direction > 0 ? 24 : -24 }),
  center: { opacity: 1, x: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction > 0 ? -24 : 24 }),
};

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (!PAIRED_ROUTES.includes(pathname)) {
    return <>{children}</>;
  }

  // Session sits to the "right" of Task Bank, so moving to it slides content
  // in from the right; moving back to Task Bank slides in from the left.
  const direction = pathname === '/session' ? 1 : -1;

  return (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={pathname}
        custom={direction}
        variants={variants}
        initial="enter"
        animate="center"
        exit="exit"
        transition={{ duration: 0.25, ease: 'easeInOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
