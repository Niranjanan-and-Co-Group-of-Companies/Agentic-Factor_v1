import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', fontFamily: 'var(--font-sans)', padding: 24,
    }}>
      <div style={{ textAlign: 'center', maxWidth: 480 }}>
        <div style={{ fontSize: '3rem', fontWeight: 800, color: 'var(--accent)', marginBottom: 8, letterSpacing: '-2px' }}>404</div>
        <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Page not found
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 28 }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          style={{
            background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)',
            padding: '10px 28px', fontSize: '0.88rem', fontWeight: 600, textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
