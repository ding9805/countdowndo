'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { analyticsPageFields, isTrackedPath } from '@/lib/analytics';

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function AnalyticsPageTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!GA_ID || !pathname || typeof window === 'undefined') return;
    const w = window as any;
    if (typeof w.gtag === 'function') {
      w.gtag('config', GA_ID, analyticsPageFields({ origin: window.location.origin, pathname }));
    }
  }, [pathname]);

  return null;
}

/** Sends user_id to GA4 when authenticated (database ID, not email) */
function UserIdTracker() {
  const { data: session, status } = useSession();
  const sentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!GA_ID || typeof window === 'undefined') return;
    const w = window as any;
    if (typeof w.gtag !== 'function') return;

    const userId = session?.user?.id;

    if (status === 'authenticated' && userId && sentRef.current !== userId) {
      // Set user_id for all subsequent events
      w.gtag('config', GA_ID, { user_id: userId, ...analyticsPageFields(window.location) });
      w.gtag('set', 'user_properties', { user_id: userId });
      sentRef.current = userId;
    } else if (status === 'unauthenticated' && sentRef.current !== null) {
      // Clear user_id on logout
      w.gtag('config', GA_ID, { user_id: undefined, ...analyticsPageFields(window.location) });
      w.gtag('set', 'user_properties', { user_id: undefined });
      sentRef.current = null;
    }
  }, [session, status]);

  return null;
}

export function GoogleAnalytics() {
  const pathname = usePathname();

  if (!GA_ID || GA_ID === 'G-XXXXXXXXXX') return null;
  // Not even loaded on a page whose URL holds a secret: gtag reports the
  // address of the page it starts on.
  if (pathname && !isTrackedPath(pathname)) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', {
            page_path: window.location.pathname,
            page_location: window.location.origin + window.location.pathname,
          });
        `}
      </Script>
      <AnalyticsPageTracker />
      <UserIdTracker />
    </>
  );
}
