const page: React.CSSProperties = {
  background: '#f1f5f9', minHeight: '100vh', padding: '40px 16px', color: '#0f172a',
  fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
};

export function NotFound() {
  return (
    <main style={page}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <h1 style={{ fontSize: 22 }}>Link not recognized</h1>
        <p style={{ color: '#64748b', fontSize: 16 }}>Please use the link from your email, or ask the tennis office to resend it.</p>
      </div>
    </main>
  );
}

export function Closed({ clubName }: { clubName: string }) {
  return (
    <main style={page}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>
        <div style={{ fontSize: 13, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b' }}>{clubName}</div>
        <h1 style={{ fontSize: 22 }}>Sign-ups are closed</h1>
        <p style={{ color: '#64748b', fontSize: 16 }}>Still want to play? Reply to the email or contact the tennis office.</p>
      </div>
    </main>
  );
}
