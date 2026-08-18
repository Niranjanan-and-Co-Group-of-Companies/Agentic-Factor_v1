'use client';

import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[GlobalError]', error); }, [error]);

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)', padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontSize: '2.5rem', marginBottom: 16 }}>⚡</div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 24 }}>
          An unexpected error occurred. Your data is safe — try refreshing the page.
          If this keeps happening, reach out to support.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
              background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
              padding: '10px 24px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            style={{
              background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)', padding: '10px 24px', fontSize: '0.88rem',
              fontWeight: 500, textDecoration: 'none', display: 'inline-block',
            }}
          >
            Go to Dashboard
          </a>
        </div>
        {error.digest && (
          <p style={{ marginTop: 20, fontSize: '0.7rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
