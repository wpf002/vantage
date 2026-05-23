'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/api';

/**
 * Phase 10 — browser web-push enable/disable + test, client-side. Uses the
 * native Notification + PushManager APIs against the registered service worker.
 */

type Status = 'loading' | 'unsupported' | 'subscribed' | 'idle' | 'error';

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function PushControls() {
  const [status, setStatus] = useState<Status>('loading');
  const [vapidKey, setVapidKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('unsupported');
        return;
      }
      try {
        const cfg = await apiGet<{ vapidPublicKey: string | null; enabled: boolean }>(
          '/v1/alerts/web-push/subscribe',
        );
        setVapidKey(cfg.vapidPublicKey);
        const reg = await navigator.serviceWorker.ready.catch(() => null);
        const existing = reg ? await reg.pushManager.getSubscription() : null;
        setStatus(existing ? 'subscribed' : 'idle');
      } catch {
        setStatus('error');
      }
    })();
  }, []);

  async function enable() {
    setMessage(null);
    try {
      if (!vapidKey) {
        setMessage('Push is not configured on the server (missing VAPID key).');
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage('Permission denied.');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      await apiPost('/v1/alerts/web-push/subscribe', {
        subscription: { endpoint: json.endpoint, keys: json.keys },
        userAgent: navigator.userAgent,
      });
      setStatus('subscribed');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to enable notifications.');
      setStatus('error');
    }
  }

  async function disable() {
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const json = sub.toJSON() as { endpoint?: string };
        await sub.unsubscribe();
        await apiPost('/v1/alerts/web-push/subscribe', { endpoint: json.endpoint }).catch(() => undefined);
        // DELETE via fetch (apiPost is POST); use the client api directly.
        await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1/alerts/web-push/subscribe`,
          {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ endpoint: json.endpoint }),
          },
        ).catch(() => undefined);
      }
      setStatus('idle');
    } catch {
      setStatus('error');
    }
  }

  async function test() {
    setMessage(null);
    try {
      await apiPost('/v1/alerts/test', {});
      setMessage('Test alert dispatched — watch for the notification.');
    } catch {
      setMessage('Test dispatch failed.');
    }
  }

  if (status === 'loading') {
    return <p className="font-mono text-xs text-ink-500">Checking…</p>;
  }
  if (status === 'unsupported') {
    return (
      <p className="font-serif text-ink-700">
        This browser doesn&apos;t support web push notifications.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {status === 'subscribed' ? (
        <div className="flex items-center gap-6">
          <span className="font-serif text-ink-900">Active on this browser.</span>
          <button
            type="button"
            onClick={() => void disable()}
            className="font-sans text-eyebrow uppercase tracking-wider text-editorial hover:text-editorial-dark"
          >
            Disable
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void enable()}
          className="font-display text-xl text-editorial border-b-2 border-editorial hover:text-editorial-dark hover:border-editorial-dark"
        >
          Enable Notifications →
        </button>
      )}

      <div className="pt-2">
        <button
          type="button"
          onClick={() => void test()}
          className="font-sans text-eyebrow uppercase tracking-wider text-ink-700 hover:text-editorial"
        >
          Send a Test Alert →
        </button>
      </div>

      {message ? <p className="font-serif italic text-ink-500 text-sm">{message}</p> : null}
    </div>
  );
}
