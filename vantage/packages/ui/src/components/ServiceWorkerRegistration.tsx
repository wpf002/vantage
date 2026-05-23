'use client';

import { useEffect } from 'react';

/**
 * Phase 10 — registers the web-push service worker once on mount. The actual
 * push subscription is created on the notifications settings page after the
 * user grants permission.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
