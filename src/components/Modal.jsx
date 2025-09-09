import React from 'react';

export default function Modal({ onClose, children }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div style={{ background: '#0b1320', color: '#e5e7eb', border: '1px solid #D4AF37', borderOpacity: 0.2, borderRadius: 12, width: 'min(900px, 96vw)', maxHeight: '90vh', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

