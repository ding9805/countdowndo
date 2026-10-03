/**
 * Regression tests for what Google Analytics is told about a page.
 *
 * The password-reset link carries its token in the query string, and page
 * views used to be reported with the query string included, handing the
 * token to Google. Analytics now skips that page entirely and only ever gets
 * a page's path.
 */

import { analyticsPageFields, isTrackedPath } from '@/lib/analytics';

describe('analytics page reporting', () => {
  test('the password-reset page is never tracked', () => {
    expect(isTrackedPath('/reset-password')).toBe(false);
    expect(isTrackedPath('/reset-password/')).toBe(false);
  });

  test('other pages are tracked, including one that merely starts the same way', () => {
    expect(isTrackedPath('/')).toBe(true);
    expect(isTrackedPath('/login')).toBe(true);
    expect(isTrackedPath('/reset-passwords')).toBe(true);
  });

  test('page fields carry the path but never the query string', () => {
    const location = new URL('https://countdowndo.example/login?callbackUrl=%2Fgoals&token=abc123');

    expect(analyticsPageFields(location)).toEqual({
      page_path: '/login',
      page_location: 'https://countdowndo.example/login',
    });
  });
});
