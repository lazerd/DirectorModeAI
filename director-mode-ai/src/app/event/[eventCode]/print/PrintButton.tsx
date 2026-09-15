'use client';

export default function PrintButton() {
  return (
    <button type="button" className="wc-btn wc-btn-primary" onClick={() => window.print()}>
      Print
    </button>
  );
}
