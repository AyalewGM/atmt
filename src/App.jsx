import React, { useEffect, useState } from 'react';
import firebaseService from './services/firebaseService';
import VisualInsights from './components/VisualInsights';

export default function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState(null);
  const [showVisual, setShowVisual] = useState(false);

  useEffect(() => {
    firebaseService.init();
    const unsub = firebaseService.watchAuth({
      onReady: () => setReady(true),
      onUser: (u) => setUser(u),
    });
    return () => unsub?.();
  }, []);

  return (
    <div style={{ padding: 24, color: '#e5e7eb', background: '#0a0f1c', minHeight: '100vh' }}>
      <h1 style={{ marginTop: 0 }}>ATMT Creator Hub</h1>
      <p style={{ color: '#9ca3af' }}>Welcome{user ? `, ${user.uid.substring(0, 6)}…` : ''}. {ready ? '' : 'Initializing…'}</p>

      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        <button onClick={() => setShowVisual(true)} disabled={!user} style={{ background: '#D4AF37', color: '#111827', fontWeight: 700, padding: '8px 12px', borderRadius: 8, opacity: user ? 1 : 0.7 }}>Open Visual Insights</button>
      </div>

      {showVisual && (
        <VisualInsights userId={user?.uid} onClose={() => setShowVisual(false)} />
      )}
    </div>
  );
}

