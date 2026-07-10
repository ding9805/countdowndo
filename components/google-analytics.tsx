'use client';

import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, Suspense, useRef } from 'react';
import { useSession } from 'next-auth/react';

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

function AnalyticsPageTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!GA_ID || !pathname || typeof window === 'undefined') return;
    const w = window as any;
    if (typeof w.gtag === 'function') {
      w.gtag('config', GA_ID, {
        page_path: pathname + (searchParams?.toString() ? '?' + searchParams.toString() : ''),
      });
    }
  }, [pathname, searchParams]);

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
      w.gtag('config', GA_ID, { user_id: userId });
      w.gtag('set', 'user_properties', { user_id: userId });
      sentRef.current = userId;
    } else if (status === 'unauthenticated' && sentRef.current !== null) {
      // Clear user_id on logout
      w.gtag('config', GA_ID, { user_id: undefined });
      w.gtag('set', 'user_properties', { user_id: undefined });
      sentRef.current = null;
    }
  }, [session, status]);

  return null;
}

export function GoogleAnalytics() {
  if (!GA_ID || GA_ID === 'G-XXXXXXXXXX') return null;

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
          });
        `}
      </Script>
      <Suspense fallback={null}>
        <AnalyticsPageTracker />
        <UserIdTracker />
      </Suspense>
    </>
  );
}
